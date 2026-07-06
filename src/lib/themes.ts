// Theme engine. Bundled shadcn/tweakcn-style presets + runtime install of any
// tweakcn theme (registry JSON or raw CSS). Themes are complete token maps
// applied as inline CSS variables on <html>, overriding the base tokens.

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

// Build a full, harmonious token set from a hue + a couple of knobs so every
// bundled theme restyles the whole app (background, cards, borders, accent),
// not just the accent colour.
function makeTheme(
  id: string,
  name: string,
  hue: number,
  primaryLight: string,
  primaryDark: string,
  radius = "0.625rem"
): Theme {
  const light: Record<string, string> = {
    background: `oklch(0.985 0.006 ${hue})`,
    foreground: `oklch(0.22 0.02 ${hue})`,
    card: `oklch(1 0 0)`,
    "card-foreground": `oklch(0.22 0.02 ${hue})`,
    popover: `oklch(1 0 0)`,
    "popover-foreground": `oklch(0.22 0.02 ${hue})`,
    primary: primaryLight,
    "primary-foreground": `oklch(0.985 0.005 ${hue})`,
    secondary: `oklch(0.955 0.012 ${hue})`,
    "secondary-foreground": `oklch(0.28 0.03 ${hue})`,
    muted: `oklch(0.955 0.01 ${hue})`,
    "muted-foreground": `oklch(0.53 0.02 ${hue})`,
    accent: `oklch(0.93 0.04 ${hue})`,
    "accent-foreground": `oklch(0.30 0.06 ${hue})`,
    destructive: `oklch(0.58 0.24 27)`,
    border: `oklch(0.9 0.012 ${hue})`,
    input: `oklch(0.9 0.012 ${hue})`,
    ring: primaryLight,
    "sidebar": `oklch(0.985 0.006 ${hue})`,
    "sidebar-primary": primaryLight,
    radius,
  };
  const dark: Record<string, string> = {
    background: `oklch(0.17 0.02 ${hue})`,
    foreground: `oklch(0.96 0.006 ${hue})`,
    card: `oklch(0.21 0.024 ${hue})`,
    "card-foreground": `oklch(0.96 0.006 ${hue})`,
    popover: `oklch(0.21 0.024 ${hue})`,
    "popover-foreground": `oklch(0.96 0.006 ${hue})`,
    primary: primaryDark,
    "primary-foreground": `oklch(0.17 0.02 ${hue})`,
    secondary: `oklch(0.27 0.02 ${hue})`,
    "secondary-foreground": `oklch(0.96 0.006 ${hue})`,
    muted: `oklch(0.27 0.02 ${hue})`,
    "muted-foreground": `oklch(0.72 0.02 ${hue})`,
    accent: `oklch(0.31 0.05 ${hue})`,
    "accent-foreground": `oklch(0.96 0.006 ${hue})`,
    destructive: `oklch(0.7 0.19 22)`,
    border: `oklch(1 0 0 / 12%)`,
    input: `oklch(1 0 0 / 15%)`,
    ring: primaryDark,
    "sidebar": `oklch(0.21 0.024 ${hue})`,
    "sidebar-primary": primaryDark,
    radius,
  };
  return { id, name, builtin: true, tokens: { light, dark } };
}

export const BUILTIN_THEMES: Theme[] = [
  makeTheme("simon", "Simon (default)", 152, "oklch(0.62 0.16 152)", "oklch(0.72 0.17 152)"),
  makeTheme("slate", "Slate", 250, "oklch(0.45 0.06 255)", "oklch(0.72 0.05 255)"),
  makeTheme("amethyst", "Amethyst", 300, "oklch(0.55 0.19 300)", "oklch(0.7 0.16 300)", "0.9rem"),
  makeTheme("sunset", "Sunset", 40, "oklch(0.64 0.16 45)", "oklch(0.74 0.15 55)"),
  makeTheme("ocean", "Ocean", 220, "oklch(0.55 0.13 230)", "oklch(0.7 0.13 225)", "0.75rem"),
  makeTheme("rose", "Rose", 12, "oklch(0.6 0.2 14)", "oklch(0.7 0.17 14)", "1.1rem"),
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
