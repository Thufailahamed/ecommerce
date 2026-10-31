"use client";
import clsx from "clsx";
import { Check } from "lucide-react";
import { contrast, FONTS, THEME_PRESETS, type FontKey, type Palette, type Theme } from "@convertflow/store-builder";
import { fontVar } from "@/components/storefront/fonts";
import { useBuilder } from "./state";
import { ColorField, PanelSection, Segmented, SelectField } from "./controls";

const PALETTE_LABELS: { key: keyof Palette; label: string }[] = [
  { key: "background", label: "Background" }, { key: "surface", label: "Surface" }, { key: "text", label: "Text" }, { key: "muted", label: "Muted text" },
  { key: "primary", label: "Primary" }, { key: "primaryText", label: "On primary" }, { key: "accent", label: "Accent" }, { key: "border", label: "Borders" },
];
const fontOptions = (Object.keys(FONTS) as FontKey[]).map((k) => ({ value: k, label: `${FONTS[k].label} · ${FONTS[k].kind}` }));

const samePalette = (a: Palette, b: Palette) => PALETTE_LABELS.every(({ key }) => a[key] === b[key]);

export function DesignPanel() {
  const { doc, apply, canEdit } = useBuilder();
  const t = doc.theme;
  const set = (theme: Partial<Theme> | { palette: Partial<Palette> }, key: string) => apply([{ op: "set_theme", theme }], `theme:${key}`);
  const readable = contrast(t.palette.text, t.palette.background);

  return (
    <fieldset disabled={!canEdit} className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
      <PanelSection title="Theme presets" description="Start from a look, then fine-tune. Your content stays the same.">
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((p) => {
            const on = samePalette(p.theme.palette, t.palette) && p.theme.fonts.heading === t.fonts.heading;
            const pal = p.theme.palette;
            return (
              <button key={p.key} type="button" onClick={() => apply([{ op: "set_theme", theme: p.theme }])} aria-pressed={on}
                className={clsx("group overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5", on ? "border-brand ring-2 ring-brand-soft" : "border-line hover:border-line-strong")}>
                <div className="relative h-14 px-3 pt-2.5" style={{ background: pal.background, color: pal.text }}>
                  <div className="text-[13px] font-semibold" style={{ fontFamily: fontVar(p.theme.fonts.heading), textTransform: p.theme.headingCase === "uppercase" ? "uppercase" : "none" }}>Aa</div>
                  <div className="absolute bottom-2 left-3 flex gap-1">
                    {[pal.primary, pal.accent, pal.surface].map((c, i) => <span key={i} className="size-3 rounded-full ring-1 ring-black/10" style={{ background: c }} />)}
                  </div>
                  {on && <span className="absolute right-2 top-2 grid size-4 place-items-center rounded-full bg-brand-solid text-white"><Check className="size-2.5" aria-hidden /></span>}
                </div>
                <div className="border-t border-line bg-ink/[0.02] px-3 py-1.5 text-[12px] font-medium text-ink-2">{p.label}</div>
              </button>
            );
          })}
        </div>
      </PanelSection>

      <PanelSection title="Colours" description="Text colours are adjusted automatically if they would be hard to read.">
        <div className="grid grid-cols-2 gap-x-3 gap-y-3">
          {PALETTE_LABELS.map(({ key, label }) => <ColorField key={key} label={label} value={t.palette[key]} onChange={(v) => set({ palette: { [key]: v } }, key)} />)}
        </div>
        <p className={clsx("text-[11px]", readable >= 7 ? "text-ok" : "text-ink-3")}>Text contrast {readable.toFixed(1)}:1 {readable >= 7 ? "· excellent" : readable >= 4.5 ? "· good" : ""}</p>
      </PanelSection>

      <PanelSection title="Typography">
        <SelectField label="Headings" value={t.fonts.heading} options={fontOptions} onChange={(v) => set({ fonts: { ...t.fonts, heading: v } }, "fh")} />
        <SelectField label="Body" value={t.fonts.body} options={fontOptions} onChange={(v) => set({ fonts: { ...t.fonts, body: v } }, "fb")} />
        <Segmented label="Heading weight" value={t.headingWeight} onChange={(v) => set({ headingWeight: v }, "hw")}
          options={[{ value: "400", label: "Light" }, { value: "500", label: "Regular" }, { value: "600", label: "Semi" }, { value: "700", label: "Bold" }, { value: "800", label: "Heavy" }]} />
        <Segmented label="Heading case" value={t.headingCase} onChange={(v) => set({ headingCase: v }, "hc")} options={[{ value: "normal", label: "Normal" }, { value: "uppercase", label: "UPPERCASE" }]} />
      </PanelSection>

      <PanelSection title="Shape and layout">
        <Segmented label="Corner radius" value={t.radius} onChange={(v) => set({ radius: v }, "r")}
          options={[{ value: "none", label: "None" }, { value: "sm", label: "S" }, { value: "md", label: "M" }, { value: "lg", label: "L" }, { value: "xl", label: "XL" }]} />
        <Segmented label="Buttons" value={t.buttonShape} onChange={(v) => set({ buttonShape: v }, "b")} options={[{ value: "square", label: "Square" }, { value: "rounded", label: "Rounded" }, { value: "pill", label: "Pill" }]} />
        <Segmented label="Spacing" value={t.spacing} onChange={(v) => set({ spacing: v }, "s")} options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "airy", label: "Airy" }]} />
        <Segmented label="Product images" value={t.productImageRatio} onChange={(v) => set({ productImageRatio: v }, "pi")} options={[{ value: "square", label: "Square" }, { value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} />
      </PanelSection>
    </fieldset>
  );
}
