import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

// ---- shared types (mirror the Rust structs) ----
export interface StreamOption {
  id: string;
  label: string;
  sub: string;
  size: string;
  ext: string;
  height: number | null;
  badge: string | null;
  kind: string;
}
export interface SubOption {
  code: string;
  name: string;
  auto: boolean;
}
export interface AnalyzeResult {
  title: string;
  uploader: string;
  duration: string;
  thumbnail: string | null;
  is_playlist: boolean;
  playlist_count: number;
  video: StreamOption[];
  audio: StreamOption[];
  subs: SubOption[];
  webpage_url: string;
}
export interface JobSpec {
  url: string;
  title: string;
  video_height: number | null;
  container: string;
  sub_langs: string[];
  embed_subs: boolean;
  playlist: boolean;
  out_dir: string;
}
export type JobStatus = "queued" | "downloading" | "merging" | "done" | "error" | "canceled";
export interface Job {
  id: number;
  title: string;
  format_label: string;
  status: JobStatus;
  percent: number;
  speed: string;
  eta: string;
  detail: string;
  out_dir: string;
}
export interface ToolInfo {
  ytdlp: string;
  ffmpeg: string;
}
export interface Found {
  url: string;
  title: string;
  source: string;
}
export interface SetupProgress {
  title: string;
  sub: string;
  percent: number;
}

// ---- command wrappers ----
export const api = {
  setupTools: () => invoke<ToolInfo>("setup_tools"),
  analyze: (url: string) => invoke<AnalyzeResult>("analyze", { url }),
  scanPage: (url: string) => invoke<Found[]>("scan_page", { url }),
  enqueue: (spec: JobSpec) => invoke<void>("enqueue", { spec }),
  queueSnapshot: () => invoke<Job[]>("queue_snapshot"),
  removeJob: (id: number) => invoke<void>("remove_job", { id }),
  clearFinished: () => invoke<void>("clear_finished"),
  defaultDir: () => invoke<string>("default_dir"),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  fetchThemeText: (url: string) => invoke<string>("fetch_theme_text", { url }),
};

// ---- events ----
export const onQueue = (cb: (jobs: Job[]) => void): Promise<UnlistenFn> =>
  listen<Job[]>("queue-update", (e) => cb(e.payload));
export const onSetup = (cb: (p: SetupProgress) => void): Promise<UnlistenFn> =>
  listen<SetupProgress>("setup-progress", (e) => cb(e.payload));
export const onYtdlpUpdated = (cb: (version: string) => void): Promise<UnlistenFn> =>
  listen<string>("ytdlp-updated", (e) => cb(e.payload));

// ---- folder picker ----
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, defaultPath });
  return typeof picked === "string" ? picked : null;
}
