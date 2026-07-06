# Changelog

All notable changes to Simon Says are documented here. This project follows
[Semantic Versioning](https://semver.org) and the spirit of
[Keep a Changelog](https://keepachangelog.com).

## [1.0.1] — 2026-07-06

### Added

- **Find videos on any web page.** Paste a page URL that isn't a direct video and
  Simon scans it — via yt-dlp's generic extractor plus an HTML sweep for known
  hosts (YouTube, Vimeo, Dailymotion, Twitch, TikTok, Streamable, Facebook) and
  direct media files — then lists what it found so you can pick one to download.
- **Silent yt-dlp self-update.** On launch (at most once a day) Simon quietly
  updates yt-dlp to the latest stable so downloads keep working as sites change;
  a small toast appears only when it actually updates.

### Fixed

- **Whole-playlist downloads.** Simon now downloads using the URL you pasted
  instead of yt-dlp's extracted `webpage_url`, which dropped the `&list=` param
  and caused only the single video to download.
- **Theme switching.** Bundled themes are now complete token sets, so switching
  visibly restyles the whole app (background, cards, borders, accent) instead of
  only nudging the accent colour.

## [1.0.0] — 2026-07-06

The first release. 🟢🔴🟡🔵

### Added

- **Paste a link, see every stream.** Simon reads any YouTube URL (or playlist)
  with `yt-dlp` and lists all video resolutions, audio tracks, and subtitle /
  auto-translation tracks — colour-coded (video = blue, audio = green,
  subtitles = yellow).
- **Pick your format.** Choose a resolution, container (MP4 / MKV / MP3), which
  subtitle languages to include, and whether to embed them.
- **Download queue.** Add as many downloads as you like; Simon works through
  them one at a time with live progress, speed, and ETA per item. Remove jobs,
  clear finished ones, and open the output folder when done.
- **Playlists.** Detects playlists and can grab every video in one go.
- **Themes.** Six built-in palettes plus a light/dark toggle — and you can paste
  any [tweakcn](https://tweakcn.com) theme URL (or raw CSS/JSON) to install and
  apply it locally. Custom themes are saved between sessions.
- **Zero setup.** On first launch Simon quietly downloads `yt-dlp` and `ffmpeg`
  for you (reusing a system `ffmpeg` when one is already installed).

### Notes

- Built with Tauri, React, Tailwind and shadcn/ui.
- macOS (universal) and Windows installers are published on the
  [Releases](https://github.com/kbosompem/simon-says/releases) page.
