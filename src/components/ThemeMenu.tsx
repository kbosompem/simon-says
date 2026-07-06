import { useEffect, useRef, useState } from "react";
import { Check, Palette, Trash2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/tauri";
import {
  type Mode,
  type Theme,
  parseThemeText,
  themeNameFromText,
  saveCustomTheme,
  deleteCustomTheme,
} from "@/lib/themes";

// Deliberately Radix-free: a plain useState popover + a fixed-overlay modal.
// Radix's portal/pointer-capture dropdowns don't reliably open in the macOS
// WKWebView, so this uses ordinary DOM that works in any webview.

function swatch(theme: Theme, mode: Mode): string {
  return theme.tokens[mode]?.primary || theme.tokens.light?.primary || "var(--primary)";
}

export function ThemeMenu({
  themes,
  activeId,
  mode,
  onPick,
  onChanged,
}: {
  themes: Theme[];
  activeId: string;
  mode: Mode;
  onPick: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function install() {
    const raw = url.trim();
    const pasted = paste.trim();
    if (!raw && !pasted) return;
    setBusy(true);
    try {
      let text = pasted;
      let sourceUrl = "pasted";
      if (raw) {
        sourceUrl = raw;
        text = await api.fetchThemeText(raw);
      }
      const tokens = parseThemeText(text);
      if (!tokens) throw new Error("Couldn't find any theme variables in that.");
      const name = themeNameFromText(text, sourceUrl);
      const id =
        "custom-" +
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") +
        "-" +
        Date.now().toString(36).slice(-4);
      const theme: Theme = { id, name, builtin: false, tokens };
      saveCustomTheme(theme);
      onChanged();
      onPick(id);
      toast.success(`Installed “${name}”`, { description: "Theme applied and saved locally." });
      setUrl("");
      setPaste("");
      setInstallOpen(false);
    } catch (e) {
      toast.error("Couldn't install theme", { description: String(e) });
    } finally {
      setBusy(false);
    }
  }

  function remove(id: string, name: string) {
    deleteCustomTheme(id);
    onChanged();
    if (activeId === id) onPick("simon");
    toast(`Removed “${name}”`);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen((o) => !o)}>
        <Palette className="size-4" />
        Theme
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Palette</div>
          <div className="max-h-72 overflow-y-auto">
            {themes.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    onPick(t.id);
                    setOpen(false);
                  }}
                >
                  <span className="size-4 shrink-0 rounded-full border" style={{ background: swatch(t, mode) }} />
                  <span className="flex-1 truncate">{t.name}</span>
                </button>
                {!t.builtin && (
                  <button
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(t.id, t.name)}
                    title="Remove theme"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
                {activeId === t.id && <Check className="size-4 shrink-0" />}
              </div>
            ))}
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => {
              setOpen(false);
              setInstallOpen(true);
            }}
          >
            <Sparkles className="size-4 text-simon-yellow" />
            Install from tweakcn…
          </button>
        </div>
      )}

      {installOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setInstallOpen(false);
          }}
        >
          <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Install a tweakcn theme</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Paste a theme URL from <span className="font-mono text-foreground">tweakcn.com</span> (e.g.
                  <span className="font-mono"> /r/themes/name.json</span>), or paste the CSS/JSON directly.
                </p>
              </div>
              <button onClick={() => setInstallOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="turl">Theme URL</Label>
                <Input
                  id="turl"
                  placeholder="https://tweakcn.com/r/themes/amethyst-haze.json"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpaste">…or paste CSS / JSON</Label>
                <textarea
                  id="tpaste"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  spellCheck={false}
                  placeholder=":root { --primary: oklch(...); } .dark { --primary: oklch(...); }"
                  className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setInstallOpen(false)}>
                Cancel
              </Button>
              <Button onClick={install} disabled={busy}>
                {busy ? "Installing…" : "Install & apply"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
