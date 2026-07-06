mod tools;
mod ytdlp;

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, Mutex as AsyncMutex, Notify};

use tools::{ensure_tools, maybe_update_ytdlp, ToolInfo, Tools};
use ytdlp::{analyze as yt_analyze, download_args, scan_page as yt_scan, AnalyzeResult, Found};

/// One item in the download queue, as shown in the UI.
#[derive(Clone, Serialize)]
pub struct Job {
    pub id: u64,
    pub title: String,
    pub format_label: String,
    pub status: String,
    pub percent: f32,
    pub speed: String,
    pub eta: String,
    pub detail: String,
    pub out_dir: String,
}

/// What the UI sends when the user hits "Add to Queue".
#[derive(Clone, Deserialize)]
pub struct JobSpec {
    pub url: String,
    pub title: String,
    pub video_height: Option<u32>,
    pub container: String,
    pub sub_langs: Vec<String>,
    pub embed_subs: bool,
    pub playlist: bool,
    pub out_dir: String,
}

struct Item {
    job: Job,
    spec: JobSpec,
}

pub struct AppState {
    tools: AsyncMutex<Option<Tools>>,
    items: Mutex<Vec<Item>>,
    tx: mpsc::UnboundedSender<u64>,
    next: AtomicU64,
    /// The currently-running job's id and its cancellation handle.
    cancel: Mutex<Option<(u64, Arc<Notify>)>>,
}

impl AppState {
    fn emit_queue(&self, app: &AppHandle) {
        let jobs: Vec<Job> = self.items.lock().unwrap().iter().map(|i| i.job.clone()).collect();
        let _ = app.emit("queue-update", jobs);
    }
    fn update<F: FnOnce(&mut Job)>(&self, app: &AppHandle, id: u64, f: F) {
        {
            let mut items = self.items.lock().unwrap();
            if let Some(it) = items.iter_mut().find(|i| i.job.id == id) {
                f(&mut it.job);
            }
        }
        self.emit_queue(app);
    }
    fn set_status(&self, app: &AppHandle, id: u64, status: &str, pct: Option<f32>) {
        self.update(app, id, |j| {
            j.status = status.into();
            if let Some(p) = pct {
                j.percent = p;
            }
            if status == "done" {
                j.speed.clear();
                j.eta.clear();
                j.detail.clear();
            }
        });
    }
    fn set_error(&self, app: &AppHandle, id: u64, msg: &str) {
        self.update(app, id, |j| {
            j.status = "error".into();
            j.detail = msg.to_string();
        });
    }
}

/// Build a process Command that never flashes a console window on Windows.
pub fn cmd(program: &std::path::Path) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    tokio::process::Command::from(c)
}

// ---------------- worker ----------------
async fn worker(app: AppHandle, state: Arc<AppState>, mut rx: mpsc::UnboundedReceiver<u64>) {
    while let Some(id) = rx.recv().await {
        let spec = {
            let items = state.items.lock().unwrap();
            items.iter().find(|i| i.job.id == id).map(|i| i.spec.clone())
        };
        let Some(spec) = spec else { continue }; // removed before it started
        let tools = { state.tools.lock().await.clone() };
        let Some(tools) = tools else {
            state.set_error(&app, id, "Tools aren't ready yet");
            continue;
        };

        state.set_status(&app, id, "downloading", Some(0.0));
        let cancel = Arc::new(Notify::new());
        *state.cancel.lock().unwrap() = Some((id, cancel.clone()));

        let result = run_job(&app, &state, &tools, id, &spec, cancel).await;

        *state.cancel.lock().unwrap() = None;
        match result {
            Ok(true) => state.set_status(&app, id, "done", Some(100.0)),
            Ok(false) => state.set_status(&app, id, "canceled", None),
            Err(e) => state.set_error(&app, id, &e),
        }
    }
}

async fn run_job(
    app: &AppHandle,
    state: &Arc<AppState>,
    tools: &Tools,
    id: u64,
    spec: &JobSpec,
    cancel: Arc<Notify>,
) -> Result<bool, String> {
    let args = download_args(spec, tools);
    let mut child = cmd(&tools.ytdlp)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start yt-dlp: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // stderr: remember the last ERROR line for reporting.
    let err_buf = Arc::new(Mutex::new(String::new()));
    {
        let err_buf = err_buf.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.contains("ERROR") {
                    *err_buf.lock().unwrap() = line;
                }
            }
        });
    }

    // stdout: parse progress + phase transitions.
    let reader = {
        let app = app.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut last_pct = -1i32;
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(rest) = line.strip_prefix("SIMON|") {
                    let mut parts = rest.split('|');
                    let pct = parse_pct(parts.next().unwrap_or(""));
                    let speed = clean(parts.next().unwrap_or(""));
                    let eta = clean(parts.next().unwrap_or(""));
                    if pct.round() as i32 != last_pct {
                        last_pct = pct.round() as i32;
                        state.update(&app, id, |j| {
                            j.percent = pct;
                            j.speed = speed.clone();
                            j.eta = eta.clone();
                            if j.status == "merging" {
                                j.status = "downloading".into();
                            }
                        });
                    }
                } else if is_merge_line(&line) {
                    state.update(&app, id, |j| {
                        j.status = "merging".into();
                        j.detail = "merging with ffmpeg".into();
                    });
                }
            }
        })
    };

    let status = tokio::select! {
        s = child.wait() => Some(s.map_err(|e| e.to_string())?),
        _ = cancel.notified() => None,
    };
    // On cancel the wait-future above is dropped, so we can borrow child again.
    if status.is_none() {
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    let _ = reader.await;

    match status {
        None => Ok(false),
        Some(s) if s.success() => Ok(true),
        Some(_) => {
            let e = err_buf.lock().unwrap().clone();
            Err(if e.trim().is_empty() {
                "Download failed — check the link and try again.".into()
            } else {
                e.replace("ERROR:", "").trim().to_string()
            })
        }
    }
}

fn is_merge_line(l: &str) -> bool {
    l.contains("[Merger]")
        || l.contains("Merging formats")
        || l.contains("[ExtractAudio]")
        || l.contains("[VideoConvertor]")
        || l.contains("Converting")
}
fn parse_pct(s: &str) -> f32 {
    s.chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .parse()
        .unwrap_or(0.0)
}
fn clean(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("unknown") || t == "N/A" {
        String::new()
    } else {
        t.to_string()
    }
}

fn format_label(s: &JobSpec) -> String {
    let mut bits: Vec<String> = Vec::new();
    match s.video_height {
        Some(h) => bits.push(format!("{h}p")),
        None => bits.push("audio".into()),
    }
    bits.push(s.container.clone());
    if !s.sub_langs.is_empty() {
        bits.push(format!("+{} subs", s.sub_langs.len()));
    }
    if s.playlist {
        bits.push("playlist".into());
    }
    bits.join(" · ")
}

// ---------------- commands ----------------
#[tauri::command]
async fn setup_tools(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<ToolInfo, String> {
    let (tools, info) = ensure_tools(&app).await?;
    *state.tools.lock().await = Some(tools.clone());
    // Silently keep yt-dlp fresh in the background (throttled to once per day).
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move { maybe_update_ytdlp(&app2, &tools).await });
    Ok(info)
}

#[tauri::command]
async fn scan_page(state: State<'_, Arc<AppState>>, url: String) -> Result<Vec<Found>, String> {
    let tools = state
        .tools
        .lock()
        .await
        .clone()
        .ok_or("Simon is still setting up — one moment.")?;
    yt_scan(&tools, url.trim()).await
}

#[tauri::command]
async fn analyze(state: State<'_, Arc<AppState>>, url: String) -> Result<AnalyzeResult, String> {
    let tools = state
        .tools
        .lock()
        .await
        .clone()
        .ok_or("Simon is still setting up — one moment.")?;
    yt_analyze(&tools, url.trim()).await
}

#[tauri::command]
fn enqueue(app: AppHandle, state: State<'_, Arc<AppState>>, spec: JobSpec) -> Result<(), String> {
    if spec.out_dir.trim().is_empty() {
        return Err("Choose a folder to save into first.".into());
    }
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    let job = Job {
        id,
        title: spec.title.clone(),
        format_label: format_label(&spec),
        status: "queued".into(),
        percent: 0.0,
        speed: String::new(),
        eta: String::new(),
        detail: String::new(),
        out_dir: spec.out_dir.clone(),
    };
    state.items.lock().unwrap().push(Item { job, spec });
    state.emit_queue(&app);
    let _ = state.tx.send(id);
    Ok(())
}

#[tauri::command]
fn queue_snapshot(state: State<'_, Arc<AppState>>) -> Vec<Job> {
    state.items.lock().unwrap().iter().map(|i| i.job.clone()).collect()
}

#[tauri::command]
fn remove_job(app: AppHandle, state: State<'_, Arc<AppState>>, id: u64) {
    if let Some((cid, notify)) = state.cancel.lock().unwrap().as_ref() {
        if *cid == id {
            notify.notify_waiters();
        }
    }
    state.items.lock().unwrap().retain(|i| i.job.id != id);
    state.emit_queue(&app);
}

#[tauri::command]
fn clear_finished(app: AppHandle, state: State<'_, Arc<AppState>>) {
    state
        .items
        .lock()
        .unwrap()
        .retain(|i| !matches!(i.job.status.as_str(), "done" | "error" | "canceled"));
    state.emit_queue(&app);
}

#[tauri::command]
fn default_dir(app: AppHandle) -> String {
    app.path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn fetch_theme_text(url: String) -> Result<String, String> {
    if !url.starts_with("http") {
        return Err("That doesn't look like a URL.".into());
    }
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (tx, rx) = mpsc::unbounded_channel::<u64>();
    let state = Arc::new(AppState {
        tools: AsyncMutex::new(None),
        items: Mutex::new(Vec::new()),
        tx,
        next: AtomicU64::new(1),
        cancel: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(worker(handle, state, rx));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            setup_tools,
            analyze,
            scan_page,
            enqueue,
            queue_snapshot,
            remove_job,
            clear_finished,
            default_dir,
            open_path,
            fetch_theme_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running Simon Says");
}
