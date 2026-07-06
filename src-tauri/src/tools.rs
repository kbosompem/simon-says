use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::cmd;

/// Resolved locations of the two binaries Simon drives.
#[derive(Clone)]
pub struct Tools {
    pub ytdlp: PathBuf,
    pub ffmpeg: PathBuf,
}

#[derive(Clone, Serialize)]
pub struct ToolInfo {
    pub ytdlp: String,
    pub ffmpeg: String,
}

#[derive(Clone, Serialize)]
struct SetupProgress {
    title: String,
    sub: String,
    percent: f32,
}

fn progress(app: &AppHandle, title: &str, sub: &str, percent: f32) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            title: title.into(),
            sub: sub.into(),
            percent,
        },
    );
}

const YTDLP_WIN: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const YTDLP_MAC: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
const YTDLP_LINUX: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
#[allow(dead_code)] // used only on Windows
const FFMPEG_WIN: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";
#[allow(dead_code)] // used only on macOS
const FFMPEG_MAC: &str = "https://evermeet.cx/ffmpeg/getrelease/zip";

/// Ensure yt-dlp and ffmpeg exist locally, downloading them on first run.
/// ffmpeg is reused from the system PATH when present (handy on macOS/Homebrew).
pub async fn ensure_tools(app: &AppHandle) -> Result<(Tools, ToolInfo), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    // ---- yt-dlp ----
    let ytdlp = dir.join(if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" });
    if !ytdlp.exists() {
        progress(app, "Getting Simon ready…", "Downloading yt-dlp", 10.0);
        let url = if cfg!(windows) {
            YTDLP_WIN
        } else if cfg!(target_os = "macos") {
            YTDLP_MAC
        } else {
            YTDLP_LINUX
        };
        download_file(url, &ytdlp).await?;
        make_executable(&ytdlp).await?;
    }

    // ---- ffmpeg ----
    let ffmpeg_local = dir.join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    let ffmpeg = if ffmpeg_local.exists() {
        ffmpeg_local.clone()
    } else if let Some(sys) = find_system_ffmpeg() {
        sys
    } else {
        progress(
            app,
            "Getting Simon ready…",
            "Downloading ffmpeg — one-time, please wait",
            55.0,
        );
        download_ffmpeg(&ffmpeg_local).await?;
        make_executable(&ffmpeg_local).await?;
        ffmpeg_local.clone()
    };

    progress(app, "Almost ready…", "Checking versions", 95.0);
    let ytdlp_ver = version_of(&ytdlp, &["--version"], false).await.unwrap_or_default();
    let ffmpeg_ver = version_of(&ffmpeg, &["-version"], true).await.unwrap_or_default();
    progress(app, "Ready", "", 100.0);

    Ok((
        Tools {
            ytdlp,
            ffmpeg,
        },
        ToolInfo {
            ytdlp: ytdlp_ver,
            ffmpeg: ffmpeg_ver,
        },
    ))
}

fn find_system_ffmpeg() -> Option<PathBuf> {
    if cfg!(windows) {
        return None;
    }
    for c in [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",
    ] {
        let p = Path::new(c);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg("ffmpeg").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                return Some(PathBuf::from(s));
            }
        }
    }
    None
}

async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    tokio::fs::write(dest, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Download ffmpeg for the current platform and extract the binary to `dest`.
async fn download_ffmpeg(dest: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        extract_from_zip(FFMPEG_WIN, dest, "ffmpeg.exe").await
    }
    #[cfg(target_os = "macos")]
    {
        extract_from_zip(FFMPEG_MAC, dest, "ffmpeg").await
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = dest;
        Err("Please install ffmpeg with your package manager (e.g. `sudo apt install ffmpeg`).".into())
    }
}

/// Fetch a zip archive and copy the first entry whose file name matches `wanted`.
#[cfg(any(windows, target_os = "macos"))]
async fn extract_from_zip(url: &str, dest: &Path, wanted: &str) -> Result<(), String> {
    let bytes = reqwest::get(url)
        .await
        .map_err(|e| format!("ffmpeg download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("ffmpeg download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("ffmpeg download failed: {e}"))?;

    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().replace('\\', "/");
        if name.rsplit('/').next() == Some(wanted) {
            let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{wanted} not found in downloaded archive"))
}

async fn make_executable(_path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = tokio::fs::metadata(_path)
            .await
            .map_err(|e| e.to_string())?
            .permissions();
        perm.set_mode(0o755);
        tokio::fs::set_permissions(_path, perm)
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Silently self-update yt-dlp to the latest stable, at most once per day.
/// Emits `ytdlp-updated` with the new version only when it actually changes.
pub async fn maybe_update_ytdlp(app: &AppHandle, tools: &Tools) {
    let Some(dir) = tools.ytdlp.parent() else {
        return;
    };
    let marker = dir.join(".ytdlp_update_check");
    if let Ok(meta) = std::fs::metadata(&marker) {
        if let Ok(modified) = meta.modified() {
            if modified
                .elapsed()
                .map(|e| e < Duration::from_secs(86_400))
                .unwrap_or(false)
            {
                return; // checked within the last 24h
            }
        }
    }
    let _ = std::fs::write(&marker, b"");

    let before = version_of(&tools.ytdlp, &["--version"], false)
        .await
        .unwrap_or_default();
    if cmd(&tools.ytdlp).args(["-U"]).output().await.is_err() {
        return;
    }
    let after = version_of(&tools.ytdlp, &["--version"], false)
        .await
        .unwrap_or_default();
    if !after.is_empty() && after != before {
        let _ = app.emit("ytdlp-updated", after);
    }
}

/// Run `bin <args>` and pull a short version string out of the first line.
async fn version_of(bin: &Path, args: &[&str], ffmpeg_style: bool) -> Result<String, String> {
    let out = cmd(bin)
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next().unwrap_or("").trim().to_string();
    if ffmpeg_style {
        // "ffmpeg version 7.1 Copyright ..." -> "7.1"
        Ok(first
            .split_whitespace()
            .nth(2)
            .unwrap_or("")
            .to_string())
    } else {
        Ok(first)
    }
}
