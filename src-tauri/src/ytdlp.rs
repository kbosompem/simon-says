use std::collections::{BTreeMap, HashSet};

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::cmd;
use crate::tools::Tools;
use crate::JobSpec;

#[derive(Serialize, Clone)]
pub struct Found {
    pub url: String,
    pub title: String,
    pub source: String,
}

#[derive(Serialize, Clone)]
pub struct StreamOption {
    pub id: String,
    pub label: String,
    pub sub: String,
    pub size: String,
    pub ext: String,
    pub height: Option<u32>,
    pub badge: Option<String>,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct SubOption {
    pub code: String,
    pub name: String,
    pub auto: bool,
}

#[derive(Serialize, Clone)]
pub struct AnalyzeResult {
    pub title: String,
    pub uploader: String,
    pub duration: String,
    pub thumbnail: Option<String>,
    pub is_playlist: bool,
    pub playlist_count: u32,
    pub video: Vec<StreamOption>,
    pub audio: Vec<StreamOption>,
    pub subs: Vec<SubOption>,
    pub webpage_url: String,
}

/// Ask yt-dlp for the metadata of a URL (only the first item of a playlist).
pub async fn analyze(tools: &Tools, url: &str) -> Result<AnalyzeResult, String> {
    let out = cmd(&tools.ytdlp)
        .args(["-J", "--no-warnings", "--playlist-items", "1", "--", url])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !out.status.success() {
        return Err(first_error_line(&String::from_utf8_lossy(&out.stderr)));
    }

    let root: Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("Couldn't read the video info ({e})"))?;

    let (media, is_playlist, count) = if root.get("entries").is_some() {
        let first = root
            .get("entries")
            .and_then(|e| e.as_array())
            .and_then(|a| a.first())
            .cloned()
            .ok_or("That playlist has no playable items")?;
        let count = root
            .get("playlist_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;
        (first, true, count)
    } else {
        (root, false, 0)
    };

    let formats = media
        .get("formats")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(AnalyzeResult {
        title: str_field(&media, "title").unwrap_or_else(|| "Untitled".into()),
        uploader: str_field(&media, "uploader")
            .or_else(|| str_field(&media, "channel"))
            .unwrap_or_default(),
        duration: fmt_duration(media.get("duration").and_then(|v| v.as_f64())),
        thumbnail: str_field(&media, "thumbnail"),
        is_playlist,
        playlist_count: count,
        video: parse_video(&formats),
        audio: parse_audio(&formats),
        subs: parse_subs(&media),
        // Use the URL the user actually pasted — yt-dlp's extracted `webpage_url`
        // strips the `&list=` param, which breaks whole-playlist downloads.
        webpage_url: url.to_string(),
    })
}

/// Scan a web page for videos yt-dlp can pull: first via yt-dlp's own generic
/// extractor (embeds, HLS, og:video…), then by scraping the HTML for links to
/// known video hosts and direct media files.
pub async fn scan_page(tools: &Tools, page_url: &str) -> Result<Vec<Found>, String> {
    let mut out: Vec<Found> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    // 1) yt-dlp generic extraction
    if let Ok(o) = cmd(&tools.ytdlp)
        .args(["--flat-playlist", "-J", "--no-warnings", "--", page_url])
        .output()
        .await
    {
        if o.status.success() {
            if let Ok(v) = serde_json::from_slice::<Value>(&o.stdout) {
                if let Some(entries) = v.get("entries").and_then(|e| e.as_array()) {
                    for e in entries {
                        let url = e
                            .get("url")
                            .and_then(|x| x.as_str())
                            .or_else(|| e.get("webpage_url").and_then(|x| x.as_str()));
                        push_found(&mut out, &mut seen, url, e.get("title").and_then(|x| x.as_str()), "embedded");
                    }
                } else if v.get("formats").is_some() {
                    let url = v
                        .get("webpage_url")
                        .and_then(|x| x.as_str())
                        .or(Some(page_url));
                    push_found(&mut out, &mut seen, url, v.get("title").and_then(|x| x.as_str()), "embedded");
                }
            }
        }
    }

    // 2) Only scrape the HTML when yt-dlp couldn't pull anything natively.
    //    For sites yt-dlp supports (YouTube, Vimeo, …) we pass its result
    //    straight through and never second-guess it with a raw HTML sweep.
    if out.is_empty() {
        if let Ok(resp) = reqwest::get(page_url).await {
            if let Ok(html) = resp.text().await {
                scan_html(&html, &mut out, &mut seen);
            }
        }
    }

    out.truncate(40);
    Ok(out)
}

fn push_found(out: &mut Vec<Found>, seen: &mut HashSet<String>, url: Option<&str>, title: Option<&str>, source: &str) {
    let Some(u) = url else { return };
    let u = u.trim();
    if !u.starts_with("http") {
        return;
    }
    let key = u.trim_end_matches('/').to_lowercase();
    if !seen.insert(key) {
        return;
    }
    let title = title.map(|t| t.trim()).filter(|t| !t.is_empty()).unwrap_or("Video");
    out.push(Found {
        url: u.to_string(),
        title: title.chars().take(120).collect(),
        source: source.to_string(),
    });
}

fn scan_html(html: &str, out: &mut Vec<Found>, seen: &mut HashSet<String>) {
    let url_re = Regex::new(r#"(?i)https?://[^\s"'<>\\)]+"#).unwrap();
    const HOSTS: [&str; 8] = [
        "youtube.com/watch",
        "youtu.be/",
        "vimeo.com/",
        "dailymotion.com/video",
        "twitch.tv/videos",
        "tiktok.com/",
        "streamable.com/",
        "facebook.com/watch",
    ];
    for m in url_re.find_iter(html) {
        let u = m.as_str().trim_end_matches(&['"', '\'', ')', ',', '.'][..]);
        let low = u.to_lowercase();
        if let Some(host) = HOSTS.iter().find(|h| low.contains(**h)) {
            let label = host_label(host);
            let title = format!("Video on {label}");
            push_found(out, seen, Some(u), Some(title.as_str()), label.as_str());
        } else if low.ends_with(".mp4") || low.ends_with(".m3u8") || low.ends_with(".webm") {
            push_found(out, seen, Some(u), Some("Direct media file"), "direct");
        }
        if out.len() >= 40 {
            break;
        }
    }
}

fn host_label(h: &str) -> String {
    if h.contains("youtu") {
        "YouTube"
    } else if h.contains("vimeo") {
        "Vimeo"
    } else if h.contains("dailymotion") {
        "Dailymotion"
    } else if h.contains("twitch") {
        "Twitch"
    } else if h.contains("tiktok") {
        "TikTok"
    } else if h.contains("streamable") {
        "Streamable"
    } else if h.contains("facebook") {
        "Facebook"
    } else {
        "the web"
    }
    .to_string()
}

fn parse_video(formats: &[Value]) -> Vec<StreamOption> {
    // best-scoring format per height (prefer mp4, then higher bitrate)
    let mut best: BTreeMap<u32, (f64, Value)> = BTreeMap::new();
    for f in formats {
        let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
        if vcodec == "none" || vcodec.is_empty() {
            continue;
        }
        let Some(height) = f.get("height").and_then(|v| v.as_u64()) else {
            continue;
        };
        let tbr = f.get("tbr").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("");
        let score = tbr + if ext == "mp4" { 5000.0 } else { 0.0 };
        let e = best.entry(height as u32).or_insert((-1.0, Value::Null));
        if score > e.0 {
            *e = (score, f.clone());
        }
    }

    let mut list: Vec<StreamOption> = best
        .into_iter()
        .rev()
        .map(|(height, (_, f))| {
            let vcodec = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("");
            let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let fps = f.get("fps").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let label = if fps >= 50.0 {
                format!("{height}p · {}fps", fps.round() as u64)
            } else {
                format!("{height}p")
            };
            StreamOption {
                id: f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                label,
                sub: format!("{} · {}", video_codec(vcodec), ext),
                size: human_size(size_of(&f)),
                ext,
                height: Some(height),
                badge: None,
                kind: "video".into(),
            }
        })
        .take(8)
        .collect();

    if let Some(first) = list.first_mut() {
        first.badge = Some("BEST".into());
    }
    list
}

fn parse_audio(formats: &[Value]) -> Vec<StreamOption> {
    let mut auds: Vec<StreamOption> = formats
        .iter()
        .filter(|f| {
            let v = f.get("vcodec").and_then(|v| v.as_str()).unwrap_or("none");
            let a = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("none");
            v == "none" && a != "none" && !a.is_empty()
        })
        .map(|f| {
            let acodec = f.get("acodec").and_then(|v| v.as_str()).unwrap_or("");
            let ext = f.get("ext").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let abr = f
                .get("abr")
                .and_then(|v| v.as_f64())
                .or_else(|| f.get("tbr").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            StreamOption {
                id: f.get("format_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                label: format!("{} · {} kbps", audio_codec(acodec), abr.round() as u64),
                sub: ext.clone(),
                size: human_size(size_of(f)),
                ext,
                height: None,
                badge: None,
                kind: "audio".into(),
            }
        })
        .collect();

    auds.sort_by(|a, b| b.label.cmp(&a.label));
    auds.dedup_by(|a, b| a.label == b.label);
    auds.truncate(5);
    if let Some(first) = auds.first_mut() {
        first.badge = Some("BEST".into());
    }
    auds
}

fn parse_subs(media: &Value) -> Vec<SubOption> {
    let mut out: Vec<SubOption> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    if let Some(manual) = media.get("subtitles").and_then(|v| v.as_object()) {
        for (code, tracks) in manual {
            if code == "live_chat" {
                continue;
            }
            let name = track_name(tracks).unwrap_or_else(|| lang_name(code));
            seen.push(code.clone());
            out.push(SubOption {
                code: code.clone(),
                name,
                auto: false,
            });
        }
    }

    const POPULAR: [&str; 16] = [
        "en", "es", "fr", "de", "pt", "it", "nl", "ja", "ko", "zh-Hans", "hi", "ar", "ru", "tr", "id", "tw",
    ];
    if let Some(auto) = media.get("automatic_captions").and_then(|v| v.as_object()) {
        for code in POPULAR {
            if auto.contains_key(code) && !seen.iter().any(|s| s == code) {
                out.push(SubOption {
                    code: code.to_string(),
                    name: lang_name(code),
                    auto: true,
                });
            }
        }
    }
    out
}

/// Build the yt-dlp argument list for a download job.
pub fn download_args(spec: &JobSpec, tools: &Tools) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "--newline".into(),
        "--no-color".into(),
        "--progress".into(),
        "--no-warnings".into(),
        // Ride out transient YouTube 403s / throttling instead of failing the job.
        "--retries".into(),
        "10".into(),
        "--fragment-retries".into(),
        "10".into(),
        "--extractor-retries".into(),
        "3".into(),
        "--progress-template".into(),
        "download:SIMON|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s".into(),
    ];

    // Point yt-dlp at our ffmpeg (its containing directory).
    if let Some(parent) = tools.ffmpeg.parent() {
        a.push("--ffmpeg-location".into());
        a.push(parent.to_string_lossy().to_string());
    }

    // Output template.
    let tmpl = if spec.playlist {
        format!(
            "{}/%(playlist_title)s/%(playlist_index)03d - %(title)s [%(id)s].%(ext)s",
            spec.out_dir
        )
    } else {
        format!("{}/%(title)s [%(id)s].%(ext)s", spec.out_dir)
    };
    a.push("-o".into());
    a.push(tmpl);

    // Format selection.
    match spec.video_height {
        None => {
            // audio-only
            a.push("-x".into());
            a.push("--audio-format".into());
            a.push(if spec.container == "mp3" { "mp3" } else { "mp3" }.into());
            a.push("--audio-quality".into());
            a.push("0".into());
        }
        Some(h) => {
            let sel = if spec.container == "mp4" {
                format!("bv*[height<={h}][ext=mp4]+ba[ext=m4a]/bv*[height<={h}]+ba/b[height<={h}]")
            } else {
                format!("bv*[height<={h}]+ba/b[height<={h}]")
            };
            a.push("-f".into());
            a.push(sel);
            a.push("--merge-output-format".into());
            a.push(spec.container.clone());
        }
    }

    // Subtitles.
    if !spec.sub_langs.is_empty() {
        a.push("--sub-langs".into());
        a.push(spec.sub_langs.join(","));
        a.push("--write-subs".into());
        a.push("--write-auto-subs".into());
        a.push("--convert-subs".into());
        a.push("srt".into());
        if spec.embed_subs {
            a.push("--embed-subs".into());
        }
    }

    // Playlist.
    if spec.playlist {
        a.push("--yes-playlist".into());
        a.push("--ignore-errors".into());
    } else {
        a.push("--no-playlist".into());
    }

    a.push("--".into());
    a.push(spec.url.clone());
    a
}

// ---- small helpers ----
fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}
fn size_of(f: &Value) -> u64 {
    f.get("filesize")
        .and_then(|v| v.as_u64())
        .or_else(|| f.get("filesize_approx").and_then(|v| v.as_u64()))
        .unwrap_or(0)
}
fn track_name(tracks: &Value) -> Option<String> {
    tracks
        .as_array()
        .and_then(|a| a.first())
        .and_then(|t| t.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string())
}
fn human_size(bytes: u64) -> String {
    if bytes == 0 {
        return String::new();
    }
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut u = 0;
    while size >= 1024.0 && u < UNITS.len() - 1 {
        size /= 1024.0;
        u += 1;
    }
    if u >= 2 {
        format!("{size:.1} {}", UNITS[u])
    } else {
        format!("{} {}", size.round() as u64, UNITS[u])
    }
}
fn fmt_duration(secs: Option<f64>) -> String {
    let Some(s) = secs else {
        return String::new();
    };
    let s = s.round() as u64;
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{sec:02}")
    } else {
        format!("{m}:{sec:02}")
    }
}
fn video_codec(c: &str) -> &str {
    if c.starts_with("avc") || c.starts_with("h264") {
        "H.264"
    } else if c.starts_with("vp9") || c.starts_with("vp09") {
        "VP9"
    } else if c.starts_with("av01") {
        "AV1"
    } else if c.starts_with("hev") || c.starts_with("h265") {
        "HEVC"
    } else {
        "video"
    }
}
fn audio_codec(c: &str) -> &str {
    if c.starts_with("mp4a") || c.starts_with("aac") {
        "AAC"
    } else if c.starts_with("opus") {
        "Opus"
    } else if c.starts_with("vorbis") {
        "Vorbis"
    } else if c.starts_with("mp3") {
        "MP3"
    } else if c.starts_with("ac-3") || c.starts_with("ec-3") {
        "AC-3"
    } else {
        "audio"
    }
}
fn lang_name(code: &str) -> String {
    let base = code.split('-').next().unwrap_or(code);
    let name = match base {
        "en" => "English",
        "es" => "Spanish",
        "fr" => "French",
        "de" => "German",
        "pt" => "Portuguese",
        "it" => "Italian",
        "nl" => "Dutch",
        "ja" => "Japanese",
        "ko" => "Korean",
        "zh" => "Chinese",
        "hi" => "Hindi",
        "ar" => "Arabic",
        "ru" => "Russian",
        "tr" => "Turkish",
        "id" => "Indonesian",
        "tw" => "Twi",
        _ => return code.to_uppercase(),
    };
    name.to_string()
}
fn first_error_line(stderr: &str) -> String {
    for line in stderr.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("ERROR:") {
            return rest.trim().to_string();
        }
    }
    stderr
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("yt-dlp could not read that link")
        .to_string()
}
