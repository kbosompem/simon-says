import { useState } from "react";
import { Check, Palette, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/tauri";
import {
  type Mode,
  type Theme,
  parseThemeText,
  themeNameFromText,
  saveCustomTheme,
  deleteCustomTheme,
} from "@/lib/themes";

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
  const [url, setUrl] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

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
      const id = "custom-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36).slice(-4);
      const theme: Theme = { id, name, builtin: false, tokens };
      saveCustomTheme(theme);
      onChanged();
      onPick(id);
      toast.success(`Installed “${name}”`, { description: "Theme applied and saved locally." });
      setUrl("");
      setPaste("");
      setOpen(false);
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
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Palette className="size-4" />
            Theme
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Palette</DropdownMenuLabel>
          {themes.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => onPick(t.id)} className="gap-2">
              <span className="size-4 shrink-0 rounded-full border" style={{ background: swatch(t, mode) }} />
              <span className="flex-1 truncate">{t.name}</span>
              {!t.builtin && (
                <button
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    remove(t.id, t.name);
                  }}
                  title="Remove theme"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
              {activeId === t.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)} className="gap-2">
            <Sparkles className="size-4 text-simon-yellow" />
            Install from tweakcn…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Install a tweakcn theme</DialogTitle>
            <DialogDescription>
              Paste a theme URL from{" "}
              <span className="font-mono text-foreground">tweakcn.com</span> (its registry link, e.g.
              <span className="font-mono"> /r/themes/name.json</span>) and Simon will fetch and apply it. Or paste the CSS/JSON directly.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-1">
            <div className="flex flex-col gap-2">
              <Label htmlFor="theme-url">Theme URL</Label>
              <div className="flex gap-2">
                <Input
                  id="theme-url"
                  placeholder="https://tweakcn.com/r/themes/amethyst-haze.json"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="theme-paste">…or paste CSS / JSON</Label>
              <textarea
                id="theme-paste"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                spellCheck={false}
                placeholder={":root { --primary: oklch(...); } .dark { --primary: oklch(...); }"}
                className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={install} disabled={busy}>
              {busy ? "Installing…" : "Install & apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
