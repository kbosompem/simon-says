import { useEffect, useMemo, useState } from "react";
import { Check, Video, Music, Captions } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnalyzeResult } from "@/lib/tauri";

export interface Selection {
  videoHeight: number | null;
  audioOnly: boolean;
  subLangs: string[];
}

const ACCENT = {
  video: "var(--simon-blue)",
  audio: "var(--simon-green)",
  subs: "var(--simon-yellow)",
} as const;

function Row({
  selected,
  onClick,
  accent,
  multi,
  children,
  size,
}: {
  selected: boolean;
  onClick: () => void;
  accent: string;
  multi?: boolean;
  size?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/40",
        selected ? "border-transparent" : "border-border"
      )}
      style={selected ? { borderColor: accent, background: `color-mix(in srgb, ${accent} 10%, var(--card))` } : undefined}
    >
      <span
        className={cn(
          "grid size-[18px] shrink-0 place-items-center border-2 text-white",
          multi ? "rounded-[5px]" : "rounded-full"
        )}
        style={{
          borderColor: selected ? accent : "var(--border)",
          background: selected ? accent : "transparent",
        }}
      >
        <Check className={cn("size-3 transition-opacity", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {size && <span className="font-mono text-xs tabular-nums text-muted-foreground">{size}</span>}
    </button>
  );
}

export function StreamPicker({
  analysis,
  onChange,
}: {
  analysis: AnalyzeResult;
  onChange: (sel: Selection) => void;
}) {
  const AUDIO_ONLY = -1;
  const [videoIdx, setVideoIdx] = useState(0);
  const [subs, setSubs] = useState<Set<string>>(new Set());

  // reset defaults whenever a new video is analysed
  useEffect(() => {
    setVideoIdx(0);
    const def = new Set<string>();
    const en = analysis.subs.find((s) => !s.auto && s.code.startsWith("en")) || analysis.subs.find((s) => s.code.startsWith("en"));
    if (en) def.add(en.code);
    setSubs(def);
  }, [analysis]);

  const selection = useMemo<Selection>(
    () => ({
      videoHeight: videoIdx === AUDIO_ONLY ? null : analysis.video[videoIdx]?.height ?? null,
      audioOnly: videoIdx === AUDIO_ONLY,
      subLangs: [...subs],
    }),
    [videoIdx, subs, analysis]
  );

  useEffect(() => onChange(selection), [selection, onChange]);

  const toggleSub = (code: string) =>
    setSubs((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  return (
    <Tabs defaultValue="video" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="video" className="gap-1.5">
          <Video className="size-3.5" style={{ color: ACCENT.video }} />
          Video <span className="font-mono text-[11px] text-muted-foreground">{analysis.video.length}</span>
        </TabsTrigger>
        <TabsTrigger value="audio" className="gap-1.5">
          <Music className="size-3.5" style={{ color: ACCENT.audio }} />
          Audio <span className="font-mono text-[11px] text-muted-foreground">{analysis.audio.length}</span>
        </TabsTrigger>
        <TabsTrigger value="subs" className="gap-1.5">
          <Captions className="size-3.5" style={{ color: ACCENT.subs }} />
          Subtitles <span className="font-mono text-[11px] text-muted-foreground">{analysis.subs.length}</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="video" className="mt-3 flex flex-col gap-2">
        {analysis.video.map((f, i) => (
          <Row key={f.id} selected={videoIdx === i} onClick={() => setVideoIdx(i)} accent={ACCENT.video} size={f.size}>
            <span className="flex items-center text-sm font-semibold">
              {f.label}
              {f.badge && (
                <Badge variant="secondary" className="ml-1.5 font-mono text-[10px]" style={{ color: ACCENT.video }}>
                  {f.badge}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{f.sub}</span>
          </Row>
        ))}
        <Row selected={videoIdx === AUDIO_ONLY} onClick={() => setVideoIdx(AUDIO_ONLY)} accent={ACCENT.video}>
          <span className="text-sm font-semibold">Audio only</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">skip the video track</span>
        </Row>
      </TabsContent>

      <TabsContent value="audio" className="mt-3 flex flex-col gap-2">
        {analysis.audio.length === 0 && <p className="px-1 text-sm text-muted-foreground">No separate audio tracks — audio comes with the video.</p>}
        {analysis.audio.map((f, i) => (
          <Row key={f.id} selected={i === 0} onClick={() => {}} accent={ACCENT.audio} size={f.size}>
            <span className="flex items-center text-sm font-semibold">
              {f.label}
              {f.badge && (
                <Badge variant="secondary" className="ml-1.5 font-mono text-[10px]" style={{ color: ACCENT.audio }}>
                  {f.badge}
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{f.sub}</span>
          </Row>
        ))}
        <p className="px-1 pt-1 text-xs text-muted-foreground">Simon automatically picks the best audio for your chosen format.</p>
      </TabsContent>

      <TabsContent value="subs" className="mt-3 flex flex-col gap-2">
        {analysis.subs.length === 0 && <p className="px-1 text-sm text-muted-foreground">No subtitles or translations available for this video.</p>}
        {analysis.subs.map((s) => (
          <Row key={s.code} selected={subs.has(s.code)} onClick={() => toggleSub(s.code)} accent={ACCENT.subs} multi size={s.code}>
            <span className="flex items-center text-sm font-semibold">
              {s.name}
              <Badge variant="secondary" className="ml-1.5 font-mono text-[10px]" style={{ color: `color-mix(in srgb, ${ACCENT.subs} 70%, var(--foreground))` }}>
                {s.auto ? "AUTO" : "ORIGINAL"}
              </Badge>
            </span>
            <span className="mt-0.5 block font-mono text-xs text-muted-foreground">{s.auto ? "auto-translated" : "manual"} · srt / vtt</span>
          </Row>
        ))}
      </TabsContent>
    </Tabs>
  );
}
