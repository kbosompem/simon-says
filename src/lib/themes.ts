// Theme engine. Bundled shadcn/tweakcn-style presets + runtime install of any
// tweakcn theme (registry JSON or raw CSS). Themes are token maps applied as
// inline CSS variables on <html>, so they layer over the base tokens in index.css.

export type Mode = "light" | "dark";
export interface ThemeTokens {
  light: Record<string, string>;
  dark: Record<string, string>;
}
export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  tokens: ThemeTokens;
}

// --- bundled presets (accent-driven; neutrals inherit index.css base) ---
function accent(hue: number, pl: string, pd: string, radius?: string): ThemeTokens {
  const light: Record<string, string> = {
    primary: pl,
    "primary-foreground": "oklch(0.985 0 0)",
    ring: pl,
    "sidebar-primary": pl,
    accent: `oklch(0.96 0.03 ${hue})`,
    "accent-foreground": `oklch(0.3 0.06 ${hue})`,
    "chart-1": pl,
  };
  const dark: Record<string, string> = {
    primary: pd,
    "primary-foreground": `oklch(0.2 0.03 ${hue})`,
    ring: pd,
    "sidebar-primary": pd,
    accent: `oklch(0.32 0.04 ${hue})`,
    "accent-foreground": "oklch(0.985 0 0)",
    "chart-1": pd,
  };
  if (radius) {
    light.radius = radius;
    dark.radius = radius;
  }
  return { light, dark };
}

export const BUILTIN_THEMES: Theme[] = [
  { id: "simon", name: "Simon (default)", builtin: true, tokens: accent(152, "oklch(0.62 0.16 152)", "oklch(0.72 0.17 152)") },
  { id: "graphite", name: "Graphite", builtin: true, tokens: accent(250, "oklch(0.37 0.03 250)", "oklch(0.82 0.03 250)") },
  { id: "amethyst", name: "Amethyst", builtin: true, tokens: accent(295, "oklch(0.55 0.2 295)", "oklch(0.7 0.18 295)", "0.9rem") },
  { id: "sunset", name: "Sunset", builtin: true, tokens: accent(45, "oklch(0.64 0.18 45)", "oklch(0.74 0.17 55)") },
  { id: "ocean", name: "Ocean", builtin: true, tokens: accent(210, "oklch(0.55 0.13 235)", "oklch(0.7 0.13 225)") },
  { id: "rose", name: "Rose", builtin: true, tokens: accent(12, "oklch(0.62 0.21 14)", "oklch(0.7 0.18 14)", "1.1rem") },
];

// --- apply ---
let appliedProps: string[] = [];
export function applyTheme(theme: Theme, mode: Mode) {
  const root = document.documentElement;
  appliedProps.forEach((p) => root.style.removeProperty(p));
  appliedProps = [];
  root.classList.toggle("dark", mode === "dark");
  const set = theme.tokens[mode] || {};
  for (const [k, v] of Object.entries(set)) {
    const prop = k.startsWith("--") ? k : `--${k}`;
    root.style.setProperty(prop, v);
    appliedProps.push(prop);
  }
}

// --- parse tweakcn input (registry JSON or raw CSS) ---
function stripKey(k: string): string {
  return k.replace(/^--/, "").trim();
}
function parseCssBlock(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  const block = re.exec(css)?.[1];
  if (!block) return out;
  const decl = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(block))) out[m[1].trim()] = m[2].trim();
  return out;
}
export function parseThemeText(text: string): ThemeTokens | null {
  const t = text.trim();
  if (!t) return null;
  // 1) registry JSON with cssVars
  try {
    const json = JSON.parse(t);
    const cv = json.cssVars || json.theme?.cssVars || json;
    if (cv && (cv.light || cv.dark || cv.theme)) {
      const shared: Record<string, string> = {};
      for (const [k, v] of Object.entries(cv.theme || {})) shared[stripKey(k)] = String(v);
      const light: Record<string, string> = { ...shared };
      const dark: Record<string, string> = { ...shared };
      for (const [k, v] of Object.entries(cv.light || {})) light[stripKey(k)] = String(v);
      for (const [k, v] of Object.entries(cv.dark || {})) dark[stripKey(k)] = String(v);
      if (Object.keys(light).length || Object.keys(dark).length) return { light, dark };
    }
  } catch {
    /* not JSON — fall through to CSS */
  }
  // 2) raw CSS from tweakcn "copy code"
  if (t.includes("{")) {
    const light = { ...parseCssBlock(t, ":root"), ...parseCssBlock(t, ".light") };
    const dark = parseCssBlock(t, ".dark");
    if (Object.keys(light).length || Object.keys(dark).length) return { light, dark };
  }
  return null;
}
export function themeNameFromText(text: string, url: string): string {
  try {
    const j = JSON.parse(text);
    if (j.name) return String(j.name).replace(/[-_]/g, " ");
    if (j.title) return String(j.title);
  } catch {
    /* ignore */
  }
  const slug = url.split("/").pop()?.replace(/\.json$/, "").replace(/[-_]/g, " ");
  return slug || "Custom theme";
}

// --- persistence (localStorage) ---
const K_CUSTOM = "simon.customThemes";
const K_ACTIVE = "simon.activeTheme";
const K_MODE = "simon.mode";

export function loadCustomThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(K_CUSTOM);
    return raw ? (JSON.parse(raw) as Theme[]) : [];
  } catch {
    return [];
  }
}
export function saveCustomTheme(theme: Theme) {
  const list = loadCustomThemes().filter((t) => t.id !== theme.id);
  list.push(theme);
  localStorage.setItem(K_CUSTOM, JSON.stringify(list));
}
export function deleteCustomTheme(id: string) {
  localStorage.setItem(K_CUSTOM, JSON.stringify(loadCustomThemes().filter((t) => t.id !== id)));
}
export function allThemes(): Theme[] {
  return [...BUILTIN_THEMES, ...loadCustomThemes()];
}
export function getActiveThemeId(): string {
  return localStorage.getItem(K_ACTIVE) || "simon";
}
export function setActiveThemeId(id: string) {
  localStorage.setItem(K_ACTIVE, id);
}
export function getMode(): Mode {
  const saved = localStorage.getItem(K_MODE) as Mode | null;
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
export function setMode(mode: Mode) {
  localStorage.setItem(K_MODE, mode);
}
