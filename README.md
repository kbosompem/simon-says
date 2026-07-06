<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="112" alt="Simon Says icon" />

# Simon Says

**YouTube, on your terms.** A friendly desktop front-end for `yt-dlp` and `ffmpeg` — paste a link, pick your streams, and download. No command line required.

[![Release](https://img.shields.io/github/v/release/kbosompem/simon-says?color=1f9e52)](https://github.com/kbosompem/simon-says/releases)
[![Download](https://img.shields.io/github/downloads/kbosompem/simon-says/total?color=2b74e0)](https://github.com/kbosompem/simon-says/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-e6a411.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-e23b33.svg)](https://tauri.app)

</div>

---

> In the game, you only act **when Simon says**. So here you paste a link, Simon
> shows you everything inside it, and when you're ready you tell him:
> **Simon Says: Download.**

## Why

`yt-dlp` is wonderful and `ffmpeg` is essential — but the command line isn't for
everyone. Simon Says wraps both in a small, fast desktop app so anyone can grab a
video, an audio track, a playlist, or a stack of subtitles without memorising a
single flag.

## Features

- 🔎 **See every stream.** Paste a URL and Simon lists all video resolutions,
  audio tracks, and subtitle / auto-translation tracks — colour-coded
  (🔵 video · 🟢 audio · 🟡 subtitles).
- 🎛️ **Pick format & quality.** Resolution, container (**MP4 / MKV / MP3**),
  which subtitle languages to include, and whether to embed them.
- 📋 **A real download queue.** Add as many as you like; Simon processes them one
  at a time with live progress, speed and ETA. Remove, retry, clear finished, or
  open the folder when done.
- 📚 **Playlists.** Detected automatically — grab the whole thing in one go.
- 🎨 **Themeable with [tweakcn](https://tweakcn.com).** Six built-in palettes and
  a light/dark toggle, plus **paste any tweakcn theme URL** (or raw CSS/JSON) to
  install and apply it locally. Custom themes persist between sessions.
- 📦 **Zero setup.** First launch quietly fetches `yt-dlp` and `ffmpeg` for you
  (and reuses a system `ffmpeg` if you already have one).

## Download

Grab the latest installer from the **[Releases page](https://github.com/kbosompem/simon-says/releases)**:

| Platform | File |
| --- | --- |
| **Windows** | `Simon.Says_x64-setup.exe` (or the `.msi`) |
| **macOS** | `Simon.Says_universal.dmg` (Apple Silicon + Intel) |

### First launch (unsigned builds)

These builds aren't code-signed yet, so your OS will be cautious the first time:

- **Windows** — SmartScreen may appear. Click **More info → Run anyway**.
- **macOS** — right-click the app and choose **Open**, then **Open** again. Or run:
  ```sh
  xattr -dr com.apple.quarantine "/Applications/Simon Says.app"
  ```

## Installing a tweakcn theme

1. Open **[tweakcn.com](https://tweakcn.com)** and find (or design) a theme.
2. Copy its registry URL — e.g. `https://tweakcn.com/r/themes/amethyst-haze.json` —
   or use tweakcn's **Copy code** to grab the raw CSS.
3. In Simon Says: **Theme → Install from tweakcn…**, paste it, and hit
   **Install & apply**. It's saved locally and reappears in the palette list.

## How it works

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  React + Tailwind + shadcn   │  IPC   │  Rust (Tauri) core            │
│  • stream picker & queue UI  │ <────> │  • runs yt-dlp -J (analyze)   │
│  • theme engine (tweakcn)    │        │  • runs yt-dlp + ffmpeg       │
│                              │        │  • sequential download queue  │
└─────────────────────────────┘        └──────────────────────────────┘
```

The UI never shells out itself; it asks the Rust core, which drives `yt-dlp`
(with `--ffmpeg-location` pointed at the bundled/located `ffmpeg`) and streams
progress back over Tauri events.

## Development

**Prerequisites:** [Node](https://nodejs.org) 18+, the
[Rust toolchain](https://rustup.rs), and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install          # frontend deps
npm run tauri dev    # run the app with hot reload
npm run tauri build  # produce a release bundle for your platform
```

- Frontend lives in `src/`, the Rust core in `src-tauri/src/`.
- The app icon is generated from one PNG: `npm run tauri icon <path-to-1024.png>`.

## Releasing

Pushing a version tag builds and publishes installers for **macOS (universal)**
and **Windows** automatically via GitHub Actions:

```sh
npm version 1.0.0        # bump package.json (also update tauri.conf.json + Cargo.toml)
git tag v1.0.0
git push origin main --tags
```

The [`Release`](.github/workflows/release.yml) workflow then attaches the
installers to a new GitHub Release. You can also trigger it manually from the
**Actions** tab.

## Credits

Simon Says stands on the shoulders of giants:
[yt-dlp](https://github.com/yt-dlp/yt-dlp) ·
[ffmpeg](https://ffmpeg.org) ·
[Tauri](https://tauri.app) ·
[shadcn/ui](https://ui.shadcn.com) ·
[tweakcn](https://tweakcn.com) ·
[Tailwind CSS](https://tailwindcss.com) ·
[lucide](https://lucide.dev)

## License

[MIT](LICENSE) © 2026 kbosompem. `yt-dlp` and `ffmpeg` are invoked as external
programs and retain their own licenses.
