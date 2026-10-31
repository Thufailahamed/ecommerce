import type { Palette, Theme } from "./schema";

/** Curated starting points. The AI picks one as a base or writes its own palette; contrast is repaired either way. */
export const THEME_PRESETS: { key: string; label: string; theme: Theme }[] = [
  {
    key: "minimal", label: "Minimal",
    theme: { palette: { background: "#ffffff", surface: "#f5f5f4", text: "#18181b", muted: "#71717a", primary: "#18181b", primaryText: "#ffffff", accent: "#e4572e", border: "#e4e4e7" }, fonts: { heading: "inter", body: "inter" }, radius: "md", buttonShape: "rounded", headingCase: "normal", headingWeight: "600", spacing: "comfortable", productImageRatio: "portrait" },
  },
  {
    key: "editorial", label: "Editorial",
    theme: { palette: { background: "#fbf8f3", surface: "#f1ebe1", text: "#22201c", muted: "#6f685d", primary: "#2f3b2f", primaryText: "#fbf8f3", accent: "#b5683c", border: "#e3dbcd" }, fonts: { heading: "playfair", body: "dm_sans" }, radius: "sm", buttonShape: "square", headingCase: "normal", headingWeight: "500", spacing: "airy", productImageRatio: "portrait" },
  },
  {
    key: "bold", label: "Bold",
    theme: { palette: { background: "#0e0e10", surface: "#1a1a1f", text: "#f5f5f7", muted: "#a1a1aa", primary: "#d4ff3a", primaryText: "#0e0e10", accent: "#7c5cff", border: "#2a2a31" }, fonts: { heading: "space_grotesk", body: "inter" }, radius: "lg", buttonShape: "pill", headingCase: "uppercase", headingWeight: "700", spacing: "comfortable", productImageRatio: "square" },
  },
  {
    key: "soft", label: "Soft",
    theme: { palette: { background: "#fff7f5", surface: "#ffece6", text: "#3a2a2a", muted: "#8a6f6c", primary: "#c8506a", primaryText: "#ffffff", accent: "#f2a65a", border: "#f3d9d2" }, fonts: { heading: "fraunces", body: "manrope" }, radius: "xl", buttonShape: "pill", headingCase: "normal", headingWeight: "600", spacing: "comfortable", productImageRatio: "portrait" },
  },
  {
    key: "natural", label: "Natural",
    theme: { palette: { background: "#f6f4ee", surface: "#e9e6da", text: "#1f2a1f", muted: "#5f6b5b", primary: "#3d5a40", primaryText: "#f6f4ee", accent: "#c08a3e", border: "#d9d5c6" }, fonts: { heading: "cormorant", body: "outfit" }, radius: "md", buttonShape: "rounded", headingCase: "normal", headingWeight: "600", spacing: "airy", productImageRatio: "portrait" },
  },
  {
    key: "tech", label: "Tech",
    theme: { palette: { background: "#f7f8fb", surface: "#eceff6", text: "#0b1020", muted: "#5b6478", primary: "#2350ff", primaryText: "#ffffff", accent: "#00b3a4", border: "#dde2ee" }, fonts: { heading: "outfit", body: "inter" }, radius: "lg", buttonShape: "rounded", headingCase: "normal", headingWeight: "700", spacing: "comfortable", productImageRatio: "square" },
  },
  {
    key: "luxe", label: "Luxe",
    theme: { palette: { background: "#111111", surface: "#1c1b19", text: "#f3efe7", muted: "#a59f93", primary: "#c9a96e", primaryText: "#111111", accent: "#8c6d46", border: "#2e2b26" }, fonts: { heading: "cormorant", body: "manrope" }, radius: "none", buttonShape: "square", headingCase: "uppercase", headingWeight: "500", spacing: "airy", productImageRatio: "portrait" },
  },
  {
    key: "playful", label: "Playful",
    theme: { palette: { background: "#fffdf4", surface: "#fff1c9", text: "#1d1a33", muted: "#615b80", primary: "#5b3df5", primaryText: "#ffffff", accent: "#ff6b4a", border: "#efe4bd" }, fonts: { heading: "syne", body: "dm_sans" }, radius: "xl", buttonShape: "pill", headingCase: "normal", headingWeight: "800", spacing: "comfortable", productImageRatio: "square" },
  },
];

export const presetTheme = (key: string): Theme => structuredClone((THEME_PRESETS.find((p) => p.key === key) ?? THEME_PRESETS[0]!).theme);

/* ---------- colour maths (WCAG 2.x relative luminance) ---------- */

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex: string): number {
  return 0.2126 * lin(channel(hex, 0)) + 0.7152 * lin(channel(hex, 1)) + 0.0722 * lin(channel(hex, 2));
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
export const isDark = (hex: string) => luminance(hex) < 0.2;

function mix(a: string, b: string, t: number): string {
  const out = [0, 1, 2].map((i) => Math.round((channel(a, i) * (1 - t) + channel(b, i) * t) * 255).toString(16).padStart(2, "0"));
  return `#${out.join("")}`;
}

/** Moves `fg` towards black or white until it reads on `bg` at `min`:1. Keeps the hue when it can. */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = isDark(bg) ? "#ffffff" : "#000000";
  for (let t = 0.1; t <= 1.001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/**
 * Repairs a palette so text stays readable: body text 4.5:1 on background and surface, muted text 4.5:1, button text
 * 4.5:1 on primary. AI palettes are often pretty but illegible; this runs on every theme write.
 */
export function repairPalette(p: Palette): { palette: Palette; changed: (keyof Palette)[] } {
  const out = { ...p };
  const changed: (keyof Palette)[] = [];
  const fix = (k: keyof Palette, against: string[], min: number) => {
    let v = out[k];
    for (const bg of against) v = ensureContrast(v, bg, min);
    if (v !== out[k]) { out[k] = v; changed.push(k); }
  };
  fix("text", [out.background, out.surface], 4.5);
  fix("muted", [out.background, out.surface], 4.5);
  fix("primaryText", [out.primary], 4.5);
  return { palette: out, changed };
}

const RADIUS = { none: "0px", sm: "4px", md: "8px", lg: "14px", xl: "22px" } as const;
const BUTTON = { square: "0px", rounded: "10px", pill: "999px" } as const;
const SPACING = { compact: "0.75", comfortable: "1", airy: "1.3" } as const;
const RATIO = { square: "1 / 1", portrait: "4 / 5", landscape: "4 / 3" } as const;

/** CSS custom properties for a theme. The renderer sets them on the store root; every storefront style reads them. */
export function themeVars(t: Theme, fontVar: (k: Theme["fonts"]["heading"]) => string): Record<string, string> {
  const p = t.palette;
  const darkBg = isDark(p.background);
  return {
    "--sf-bg": p.background,
    "--sf-surface": p.surface,
    "--sf-text": p.text,
    "--sf-muted": p.muted,
    "--sf-primary": p.primary,
    "--sf-primary-text": p.primaryText,
    "--sf-accent": p.accent,
    "--sf-accent-text": ensureContrast(isDark(p.accent) ? "#ffffff" : "#111111", p.accent, 4.5),
    "--sf-border": p.border,
    "--sf-inverse": darkBg ? "#f7f7f5" : "#111214",
    "--sf-inverse-text": darkBg ? "#111214" : "#f7f7f5",
    "--sf-overlay": darkBg ? "rgba(0,0,0,.55)" : "rgba(10,10,12,.45)",
    "--sf-radius": RADIUS[t.radius],
    "--sf-button-radius": BUTTON[t.buttonShape],
    "--sf-space": SPACING[t.spacing],
    "--sf-ratio": RATIO[t.productImageRatio],
    "--sf-heading-font": fontVar(t.fonts.heading),
    "--sf-body-font": fontVar(t.fonts.body),
    "--sf-heading-case": t.headingCase === "uppercase" ? "uppercase" : "none",
    "--sf-heading-weight": t.headingWeight,
    "--sf-heading-spacing": t.headingCase === "uppercase" ? "0.04em" : "-0.015em",
    "color-scheme": darkBg ? "dark" : "light",
  };
}
