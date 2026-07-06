import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, FolderOpen, Plus, Moon, Sun, ListVideo, Loader2, Film } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";

import { SimonRing } from "@/components/SimonRing";
import { StreamPicker, type Selection } from "@/components/StreamPicker";
import { QueuePanel } from "@/components/QueuePanel";
import { ThemeMenu } from "@/components/ThemeMenu";

import { api, onQueue, onSetup, onYtdlpUpdated, pickFolder, type AnalyzeResult, type Found, type Job, type JobSpec, type SetupProgress } from "@/lib/tauri";
import { allThemes, applyTheme, getActiveThemeId, getMode, setActiveThemeId, setMode, type Mode } from "@/lib/themes";

export default function App() {
  // ---- theme ----
  const [mode, setModeState] = useState<Mode>(() => getMode());
  const [activeId, setActiveId] = useState<string>(() => getActiveThemeId());
  const [themesVersion, setThemesVersion] = useState(0);
  const themes = useMemo(() => allThemes(), [themesVersion]);

  const applyActive = useCallback((id: string, m: Mode) => {
    const theme = allThemes().find((t) => t.id === id) || allThemes()[0];
    applyTheme(theme, m);
  }, []);
  useEffect(() => applyActive(activeId, mode), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickTheme = (id: string) => {
    setActiveId(id);
    setActiveThemeId(id);
    applyActive(id, mode);
  };
  const toggleMode = () => {
    const next: Mode = mode === "dark" ? "light" : "dark";
    setModeState(next);
    setMode(next);
    applyActive(activeId, next);
  };

  // ---- tool setup ----
  const [setup, setSetup] = useState<SetupProgress | null>({ title: "Getting Simon ready…", sub: "", percent: 0 });
  const [tools, setTools] = useState<{ ytdlp: string; ffmpeg: string } | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // ---- analyze ----
  const [url, setUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [pageResults, setPageResults] = useState<Found[] | null>(null);
  const [selection, setSelection] = useState<Selection>({ videoHeight: null, audioOnly: false, subLangs: [] });
  const handleSel = useCallback((s: Selection) => setSelection(s), []);

  // ---- settings ----
  const [outDir, setOutDir] = useState("");
  const [container, setContainer] = useState("mp4");
  const [embedSubs, setEmbedSubs] = useState(true);
  const [wholePlaylist, setWholePlaylist] = useState(false);

  // ---- queue ----
  const [jobs, setJobs] = useState<Job[]>([]);
  const unlisten = useRef<(() => void)[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setOutDir(await api.defaultDir());
      } catch {
        /* ignore */
      }
      unlisten.current.push(await onSetup((p) => setSetup(p)));
      unlisten.current.push(await onQueue((j) => setJobs(j)));
      unlisten.current.push(
        await onYtdlpUpdated((v) => {
          setTools((t) => (t ? { ...t, ytdlp: v } : t));
          toast.success("yt-dlp updated to " + v);
        })
      );
      try {
        setJobs(await api.queueSnapshot());
      } catch {
        /* ignore */
      }
      try {
        const info = await api.setupTools();
        setTools(info);
        setSetup(null);
      } catch (e) {
        setSetupError(String(e));
      }
    })();
    return () => unlisten.current.forEach((u) => u());
  }, []);

  async function analyze(e?: React.FormEvent) {
    e?.preventDefault();
    const u = url.trim();
    if (!u) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setPageResults(null);
    try {
      setAnalysis(await api.analyze(u));
    } catch (err) {
      // Not a direct video/playlist — try scanning the page for videos.
      setAnalysis(null);
      try {
        const found = await api.scanPage(u);
        if (found.length > 0) setPageResults(found);
        else setAnalyzeError(String(err));
      } catch {
        setAnalyzeError(String(err));
      }
    } finally {
      setAnalyzing(false);
    }
  }

  async function pickFound(f: Found) {
    setUrl(f.url);
    setPageResults(null);
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      setAnalysis(await api.analyze(f.url));
    } catch (err) {
      setAnalysis(null);
      setAnalyzeError(String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function browse() {
    const picked = await pickFolder(outDir || undefined);
    if (picked) setOutDir(picked);
  }

  const audioOnly = selection.audioOnly || container === "mp3";
  const addHint = useMemo(() => {
    if (!analysis) return "pick a link first";
    const bits: string[] = [];
    bits.push(audioOnly ? "audio" : selection.videoHeight ? `${selection.videoHeight}p` : "best");
    bits.push(container);
    if (selection.subLangs.length) bits.push(`+${selection.subLangs.length} subs`);
    if (analysis.is_playlist && wholePlaylist) bits.push("playlist");
    return bits.join(" · ");
  }, [analysis, selection, container, audioOnly, wholePlaylist]);

  async function addToQueue() {
    if (!analysis) return;
    let dir = outDir;
    if (!dir) {
      const picked = await pickFolder();
      if (!picked) return;
      dir = picked;
      setOutDir(picked);
    }
    const spec: JobSpec = {
      url: analysis.webpage_url || url.trim(),
      title: analysis.title,
      video_height: audioOnly ? null : selection.videoHeight,
      container,
      sub_langs: selection.subLangs,
      embed_subs: embedSubs && selection.subLangs.length > 0,
      playlist: analysis.is_playlist && wholePlaylist,
      out_dir: dir,
    };
    try {
      await api.enqueue(spec);
      toast.success("Added to queue", { description: analysis.title });
    } catch (e) {
      toast.error("Couldn't queue that", { description: String(e) });
    }
  }

  const activeCount = jobs.filter((j) => j.status === "downloading" || j.status === "merging").length;
  const footStatus = setupError
    ? "Setup failed"
    : setup
      ? "Setting up…"
      : activeCount
        ? `Downloading ${activeCount}…`
        : jobs.some((j) => j.status === "queued")
          ? "Queued"
          : "Ready";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* title bar */}
      <header className="flex flex-none items-center gap-3 border-b bg-gradient-to-b from-background to-muted/40 px-4 py-3">
        <SimonRing size={38} />
        <div>
          <div className="text-lg font-extrabold leading-none tracking-tight">
            Simon <span className="text-primary">Says</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">yt-dlp &amp; ffmpeg, minus the command line</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ThemeMenu themes={themes} activeId={activeId} mode={mode} onPick={pickTheme} onChanged={() => setThemesVersion((v) => v + 1)} />
          <Button variant="outline" size="icon" onClick={toggleMode} title="Toggle light / dark">
            {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* setup banner */}
      {(setup || setupError) && (
        <div className="flex flex-none items-center gap-3 border-b bg-simon-blue/10 px-4 py-3">
          {setupError ? <span className="text-simon-red">⚠</span> : <SimonRing size={22} spin />}
          <div className="flex-1">
            <div className="text-sm font-semibold">{setupError ? "Couldn't set up the tools" : setup?.title}</div>
            <div className="text-xs text-muted-foreground">{setupError || setup?.sub}</div>
            {!setupError && <Progress value={setup?.percent ?? 0} className="mt-2 h-1.5" />}
          </div>
        </div>
      )}

      {/* ask bar */}
      <form onSubmit={analyze} className="flex flex-none items-center gap-2 border-b bg-muted/40 px-4 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube link or playlist…"
            spellCheck={false}
            autoComplete="off"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={analyzing || !url.trim()}>
          {analyzing ? <Loader2 className="size-4 animate-spin" /> : null}
          {analyzing ? "Asking…" : "Ask Simon"}
        </Button>
      </form>

      {/* body */}
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1.55fr_1fr]">
        {/* left: media + streams */}
        <div className="overflow-y-auto border-b p-4 md:border-b-0 md:border-r">
          {!analysis && !analyzeError && !pageResults && (
            <div className="flex flex-col items-center gap-2 px-5 py-9 text-center">
              <SimonRing size={80} className="mb-2" />
              <p className="text-balance text-base font-bold">Paste a link and Simon will show you every stream.</p>
              <p className="max-w-sm text-balance text-sm text-muted-foreground">
                A video, a playlist, or any web page with videos on it — you pick the resolution and format, Simon does the rest.
              </p>
            </div>
          )}

          {analyzeError && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Simon couldn't read that link: {analyzeError}
            </div>
          )}

          {pageResults && (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-sm font-bold">
                  Found {pageResults.length} video{pageResults.length > 1 ? "s" : ""} on this page
                </p>
                <p className="text-xs text-muted-foreground">Not a direct link — pick one to see its download options.</p>
              </div>
              {pageResults.map((f, i) => (
                <button
                  key={i}
                  onClick={() => pickFound(f)}
                  className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40"
                >
                  <Film className="size-4 shrink-0 text-simon-blue" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{f.title}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{f.url}</span>
                  </span>
                  <Badge variant="secondary" className="shrink-0">{f.source}</Badge>
                </button>
              ))}
            </div>
          )}

          {analysis && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3.5">
                <div className="relative aspect-video w-42 flex-none overflow-hidden rounded-xl border bg-muted" style={{ width: 168 }}>
                  {analysis.thumbnail ? (
                    <img src={analysis.thumbnail} alt="" className="size-full object-cover" />
                  ) : (
                    <div className="size-full bg-gradient-to-br from-slate-700 to-slate-900" />
                  )}
                  {analysis.duration && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white">
                      {analysis.duration}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="text-balance text-[17px] font-bold leading-tight">{analysis.title}</h1>
                  <div className="mt-1.5 text-sm text-muted-foreground">{analysis.uploader}</div>
                  <div className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                    {[analysis.video.length && `${analysis.video.length} video formats`, analysis.audio.length && `${analysis.audio.length} audio`, analysis.subs.length && `${analysis.subs.length} subtitle tracks`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {analysis.is_playlist && analysis.playlist_count > 1 && (
                    <Badge variant="outline" className="mt-2.5 gap-1.5 border-simon-yellow/50 bg-simon-yellow/15">
                      <ListVideo className="size-3.5" />
                      Playlist — {analysis.playlist_count} videos
                    </Badge>
                  )}
                </div>
              </div>
              <StreamPicker analysis={analysis} onChange={handleSel} />
            </div>
          )}
        </div>

        {/* right: settings + action */}
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <div className="rounded-xl border bg-muted/40 p-4">
            <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Where &amp; how</h2>
            <div className="flex flex-col divide-y">
              <div className="flex items-center justify-between gap-3 pb-3">
                <div>
                  <div className="text-sm font-medium">Save to</div>
                  <div className="text-[11px] text-muted-foreground">{outDir ? "your chosen folder" : "choose a folder"}</div>
                </div>
                <div className="flex items-center gap-2">
                  <code className="max-w-[150px] truncate rounded border bg-card px-2 py-1.5 text-[11px] text-muted-foreground" dir="rtl" title={outDir}>
                    {outDir || "Downloads"}
                  </code>
                  <Button variant="outline" size="sm" onClick={browse}>
                    <FolderOpen className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                <div className="text-sm font-medium">Merge into</div>
                <select
                  value={container}
                  onChange={(e) => setContainer(e.target.value)}
                  className="h-9 w-[190px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  <option value="mp4">MP4 (H.264 + AAC)</option>
                  <option value="mkv">MKV (keep originals)</option>
                  <option value="mp3">MP3 (audio only)</option>
                </select>
              </div>
              <div className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium">Embed subtitles</div>
                  <div className="text-[11px] text-muted-foreground">burn picked tracks in</div>
                </div>
                <Switch checked={embedSubs} onCheckedChange={setEmbedSubs} />
              </div>
              {analysis?.is_playlist && analysis.playlist_count > 1 && (
                <div className="flex items-center justify-between gap-3 pt-3">
                  <div>
                    <div className="text-sm font-medium">Whole playlist</div>
                    <div className="text-[11px] text-muted-foreground">all {analysis.playlist_count} videos</div>
                  </div>
                  <Switch checked={wholePlaylist} onCheckedChange={setWholePlaylist} />
                </div>
              )}
            </div>
          </div>

          <Button
            size="lg"
            className="h-auto justify-start gap-3 py-3.5 text-left"
            disabled={!analysis || !!setup}
            onClick={addToQueue}
          >
            <Plus className="size-5" strokeWidth={2.5} />
            <span className="leading-tight">
              Simon Says: Add to Queue
              <span className="block text-xs font-medium opacity-90">{addHint}</span>
            </span>
          </Button>
        </div>
      </main>

      {/* queue */}
      <QueuePanel jobs={jobs} onRemove={(id) => api.removeJob(id).catch(() => {})} onClearFinished={() => api.clearFinished().catch(() => {})} onOpen={(p) => api.openPath(p).catch(() => {})} />

      {/* footer */}
      <footer className="flex flex-none items-center gap-2 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono">{tools?.ytdlp ? `yt-dlp ${tools.ytdlp}` : "yt-dlp"}</span>
        <span className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono">{tools?.ffmpeg ? `ffmpeg ${tools.ffmpeg}` : "ffmpeg"}</span>
        <span className="ml-auto">{footStatus}</span>
      </footer>

      <Toaster position="bottom-center" />
    </div>
  );
}
