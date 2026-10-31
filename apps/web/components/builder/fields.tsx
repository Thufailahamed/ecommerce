"use client";
import clsx from "clsx";
import {
  ArrowDown, ArrowUp, Award, Check, Clock, Coffee, Droplet, Feather, Gift, Globe, Heart, ImageIcon, ImagePlus, Leaf, Link2, Lock, Mail, Map,
  Package, Phone, Plus, Recycle, RefreshCw, Shield, Smile, Sparkles, Star, Sun, Trash2, Truck, Upload, Wand2, X, Zap, type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { imageUrl, linkTargets, type FieldDef, type IconKey, type Image, type Link } from "@convertflow/store-builder";
import { ASSET_BASE, builder, uploadImage, type AssetRow } from "@/lib/builder";
import { ApiError } from "@/lib/api";
import { useBuilder } from "./state";
import { Btn, IconButton, Label, Modal, NumberField, Segmented, SelectField, Switch, TextAreaField, TextField, inputClass } from "./controls";

export const ICON_COMPONENTS: Record<IconKey, LucideIcon> = {
  truck: Truck, shield: Shield, leaf: Leaf, sparkles: Sparkles, heart: Heart, star: Star, gift: Gift, recycle: Recycle, clock: Clock, award: Award,
  package: Package, refresh: RefreshCw, lock: Lock, sun: Sun, droplet: Droplet, zap: Zap, globe: Globe, smile: Smile, check: Check, phone: Phone,
  mail: Mail, map: Map, coffee: Coffee, feather: Feather,
};

/* ---------- images ---------- */

export function ImagePicker({ open, onClose, onPick, defaultPrompt = "" }: { open: boolean; onClose: () => void; onPick: (src: string, alt?: string) => void; defaultPrompt?: string }) {
  const { site, toast, updateSite } = useBuilder();
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"upload" | "generate" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt(defaultPrompt);
    builder.assets(site.id).then(setAssets).catch(() => setAssets([]));
  }, [open, site.id, defaultPrompt]);

  const upload = async (file: File) => {
    setBusy("upload");
    try { const a = await uploadImage(site.id, file, file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 120)); onPick(a.ref); onClose(); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Upload failed", "error"); }
    finally { setBusy(null); }
  };
  const generate = async () => {
    setBusy("generate");
    try {
      const a = await builder.generateImage(site.id, prompt);
      updateSite({ usage: { ...site.usage, images: { ...site.usage.images, used: site.usage.images.used + 1 } } });
      onPick(a.ref, prompt.slice(0, 160)); onClose();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Image generation failed", "error"); }
    finally { setBusy(null); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Choose an image" wide>
      <div className="grid gap-5 p-5 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label>Upload</Label>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
              className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-ink/[0.02] text-[12px] text-ink-3 transition-colors hover:border-brand-tint hover:bg-brand-soft hover:text-ink">
              {busy === "upload" ? <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Upload className="size-5" aria-hidden />}
              Drop an image or click to browse <span className="text-[11px]">JPEG, PNG, WebP up to 4 MB</span>
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
          <div>
            <TextAreaField label="Generate with AI" value={prompt} onChange={setPrompt} rows={3} placeholder="A ceramic mug on a linen tablecloth, morning light" max={600} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-ink-3">{site.ai.images ? `${site.usage.images.used}/${site.usage.images.limit} images this month` : "Image generation isn't configured"}</span>
              <Btn size="sm" variant="primary" onClick={() => void generate()} busy={busy === "generate"} disabled={!site.ai.images || prompt.trim().length < 3 || busy !== null}><Wand2 className="size-3.5" aria-hidden />Generate</Btn>
            </div>
          </div>
          <div>
            <Label>Image URL (https)</Label>
            <div className="flex gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={clsx(inputClass, "h-9")} />
              <Btn size="sm" disabled={!/^https:\/\/\S+$/.test(url)} onClick={() => { onPick(url.trim()); onClose(); }}>Use</Btn>
            </div>
          </div>
        </div>
        <div>
          <Label>Library</Label>
          {assets === null ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton aspect-square rounded-lg" />)}</div>
            : assets.length === 0 ? <p className="rounded-xl border border-line p-6 text-center text-[12px] text-ink-3">Uploaded and generated images appear here.</p>
            : (
              <div className="grid max-h-[340px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                {assets.map((a) => (
                  <button key={a.id} type="button" onClick={() => { onPick(a.ref, a.alt ?? undefined); onClose(); }} title={a.alt ?? ""}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-brand">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(a.ref, ASSET_BASE)} alt={a.alt ?? ""} loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
                    {a.source === "ai" && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">AI</span>}
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>
    </Modal>
  );
}

export function ImageField({ label, value, onChange, optional }: { label: string; value: Image | undefined; onChange: (v: Image | null) => void; optional?: boolean }) {
  const [open, setOpen] = useState(false);
  const src = value?.src ? imageUrl(value.src, ASSET_BASE) : "";
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-3">
        <button type="button" onClick={() => setOpen(true)} aria-label={src ? "Change image" : "Add image"}
          className="group relative size-20 shrink-0 overflow-hidden rounded-lg border border-line bg-ink/[0.03] transition-colors hover:border-brand-tint">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {src ? <img src={src} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-ink-3"><ImagePlus className="size-5" aria-hidden /></span>}
          <span className="absolute inset-0 grid place-items-center bg-black/50 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">{src ? "Change" : "Add"}</span>
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <TextField value={value?.alt ?? ""} onChange={(alt) => onChange({ src: value?.src ?? "", alt, ...(value?.prompt ? { prompt: value.prompt } : {}) })} placeholder="Describe the image (alt text)" max={160} />
          <div className="flex gap-1.5">
            <Btn size="sm" onClick={() => setOpen(true)}><ImageIcon className="size-3.5" aria-hidden />{src ? "Replace" : "Choose"}</Btn>
            {(src || optional) && value && <Btn size="sm" variant="ghost" onClick={() => onChange(optional ? null : { src: "", alt: value.alt })}><X className="size-3.5" aria-hidden />Remove</Btn>}
          </div>
        </div>
      </div>
      <ImagePicker open={open} onClose={() => setOpen(false)} defaultPrompt={value?.prompt ?? value?.alt ?? ""} onPick={(s, alt) => onChange({ src: s, alt: value?.alt || alt || "", ...(value?.prompt ? { prompt: value.prompt } : {}) })} />
    </div>
  );
}

/* ---------- links ---------- */

export function LinkField({ label, value, onChange, optional }: { label: string; value: Link | undefined; onChange: (v: Link | null) => void; optional?: boolean }) {
  const { doc } = useBuilder();
  const listId = useId();
  const [href, setHref] = useState(value?.href ?? "");
  useEffect(() => setHref(value?.href ?? ""), [value?.href]);
  if (!value) {
    return (
      <div>
        <Label>{label}</Label>
        <Btn size="sm" onClick={() => onChange({ label: "Shop now", href: "/collections/all" })}><Plus className="size-3.5" aria-hidden />Add {label.toLowerCase()}</Btn>
      </div>
    );
  }
  const targets = linkTargets(doc);
  return (
    <div className="rounded-lg border border-line bg-ink/[0.015] p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-2"><Link2 className="size-3.5" aria-hidden />{label}</span>
        {optional && <IconButton size="sm" icon={X} label={`Remove ${label.toLowerCase()}`} onClick={() => onChange(null)} />}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField value={value.label} onChange={(l) => onChange({ ...value, label: l })} placeholder="Label" max={40} />
        <div>
          <input list={listId} value={href} placeholder="/page or https://…" spellCheck={false}
            onChange={(e) => { setHref(e.target.value); onChange({ ...value, href: e.target.value.trim() }); }}
            className={clsx(inputClass, "h-9 font-mono text-[12px]")} aria-label={`${label} link`} />
          <datalist id={listId}>{targets.map((t) => <option key={t.href} value={t.href}>{`${t.group}: ${t.label}`}</option>)}</datalist>
        </div>
      </div>
    </div>
  );
}

/* ---------- pickers ---------- */

function ProductsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { doc } = useBuilder();
  const [q, setQ] = useState("");
  const shown = doc.products.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="rounded-lg border border-line">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-8 w-full border-b border-line bg-transparent px-3 text-[12px] text-ink placeholder:text-ink-3 focus:outline-none" />
      <ul className="max-h-48 overflow-y-auto py-1">
        {shown.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-3">No products.</li>}
        {shown.map((p) => {
          const on = value.includes(p.id);
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] text-ink-2 hover:bg-ink/[0.04]">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} className="accent-[var(--brand-solid)]" />
                <span className="truncate">{p.title}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function IconPicker({ value, onChange }: { value: IconKey; onChange: (v: IconKey) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {(Object.keys(ICON_COMPONENTS) as IconKey[]).map((k) => {
        const I = ICON_COMPONENTS[k];
        return (
          <button key={k} type="button" title={k} aria-label={k} aria-pressed={k === value} onClick={() => onChange(k)}
            className={clsx("grid aspect-square place-items-center rounded-md transition-colors", k === value ? "bg-brand-solid text-white" : "text-ink-3 hover:bg-ink/[0.07] hover:text-ink")}>
            <I className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/* ---------- the generic form ---------- */

type Obj = Record<string, unknown>;

/**
 * Renders a section's (or list item's) fields from its definition. `onPatch` receives only the changed field, with
 * `null` meaning "remove this optional field", which is exactly what the update_section operation expects.
 */
export function FieldList({ fields, value, onPatch }: { fields: FieldDef[]; value: Obj; onPatch: (patch: Obj, key: string) => void }) {
  return <div className="space-y-3.5">{fields.map((f) => <FieldControl key={f.key} f={f} value={value[f.key]} onChange={(v) => onPatch({ [f.key]: v }, f.key)} />)}</div>;
}

function FieldControl({ f, value, onChange }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const { doc } = useBuilder();
  switch (f.kind) {
    case "text": return <TextField label={f.label} value={typeof value === "string" ? value : ""} max={f.max} {...(f.placeholder ? { placeholder: f.placeholder } : {})} onChange={(v) => onChange(f.optional && v === "" ? null : v)} />;
    case "textarea": return <TextAreaField label={f.label} value={typeof value === "string" ? value : ""} max={f.max} rows={f.rows ?? 3} onChange={(v) => onChange(f.optional && v === "" ? null : v)} />;
    case "link": return <LinkField label={f.label} value={value as Link | undefined} optional={f.optional} onChange={onChange} />;
    case "image": return <ImageField label={f.label} value={value as Image | undefined} optional={f.optional} onChange={onChange} />;
    case "images": {
      const list = (Array.isArray(value) ? value : []) as Image[];
      return (
        <div>
          <Label hint={`${list.length}/${f.max}`}>{f.label}</Label>
          <div className="space-y-3">
            {list.map((img, i) => (
              <div key={i} className="relative rounded-lg border border-line p-2.5">
                <div className="absolute right-1.5 top-1.5 z-10"><IconButton size="sm" icon={Trash2} tone="danger" label="Remove image" disabled={list.length <= 1} onClick={() => onChange(list.filter((_, j) => j !== i))} /></div>
                <ImageField label={`Image ${i + 1}`} value={img} onChange={(v) => onChange(list.map((x, j) => (j === i ? v ?? { src: "", alt: "" } : x)))} />
              </div>
            ))}
            {list.length < f.max && <Btn size="sm" onClick={() => onChange([...list, { src: "", alt: "" }])}><Plus className="size-3.5" aria-hidden />Add image</Btn>}
          </div>
        </div>
      );
    }
    case "select": {
      const opts = f.options as readonly { value: string | number; label: string }[];
      const v = (value ?? opts[0]?.value) as string | number;
      return opts.length <= 4 ? <Segmented label={f.label} value={v} options={opts} onChange={onChange} /> : <SelectField label={f.label} value={v} options={opts} onChange={onChange} />;
    }
    case "boolean": return <Switch label={f.label} checked={value === true} onChange={onChange} {...(f.hint ? { hint: f.hint } : {})} />;
    case "number": return <NumberField label={f.label} value={typeof value === "number" ? value : null} min={f.min} max={f.max} onChange={(n) => { if (n !== null) onChange(Math.min(f.max, Math.max(f.min, Math.round(n)))); }} />;
    case "icon": return <div><Label>{f.label}</Label><IconPicker value={(value as IconKey) ?? "check"} onChange={onChange} /></div>;
    case "products": return <div><Label hint="Used when “Show” is Hand-picked">{f.label}</Label><ProductsPicker value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} /></div>;
    case "collection": return (
      <SelectField label={f.label} value={typeof value === "string" ? value : ""} onChange={(v) => onChange(v === "" ? null : v)}
        options={[{ value: "", label: f.optional ? "All products" : "Choose…" }, ...doc.collections.map((c) => ({ value: c.id, label: c.title }))]} />
    );
    case "collections": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          <Label>{f.label}</Label>
          <div className="flex flex-wrap gap-1.5">
            {doc.collections.length === 0 && <span className="text-[12px] text-ink-3">No collections yet.</span>}
            {doc.collections.map((c) => {
              const on = list.includes(c.id);
              return <button key={c.id} type="button" aria-pressed={on} onClick={() => onChange(on ? list.filter((x) => x !== c.id) : [...list, c.id])}
                className={clsx("rounded-full border px-2.5 py-1 text-[12px] transition-colors", on ? "border-brand bg-brand-soft text-ink" : "border-line text-ink-3 hover:text-ink")}>{c.title}</button>;
            })}
          </div>
        </div>
      );
    }
    case "strings": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          <Label hint={`${list.length}/${f.max}`}>{f.label}</Label>
          <div className="space-y-2">
            {list.map((s, i) => (
              <div key={i} className="flex gap-1.5">
                <div className="flex-1"><TextField value={s} onChange={(v) => onChange(list.map((x, j) => (j === i ? v : x)))} max={40} /></div>
                <IconButton icon={Trash2} tone="danger" label={`Remove ${f.itemLabel.toLowerCase()}`} disabled={list.length <= 1} onClick={() => onChange(list.filter((_, j) => j !== i))} />
              </div>
            ))}
            {list.length < f.max && <Btn size="sm" onClick={() => onChange([...list, f.itemLabel])}><Plus className="size-3.5" aria-hidden />Add {f.itemLabel.toLowerCase()}</Btn>}
          </div>
        </div>
      );
    }
    case "list": {
      const list = (Array.isArray(value) ? value : []) as Obj[];
      const move = (i: number, d: -1 | 1) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(i + d, 0, x!); onChange(next); };
      return (
        <div>
          <Label hint={`${list.length}/${f.max}`}>{f.label}</Label>
          <div className="space-y-2">
            {list.map((item, i) => (
              <details key={i} className="group rounded-lg border border-line bg-ink/[0.015] open:bg-ink/[0.03]">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] text-ink-2 [&::-webkit-details-marker]:hidden">
                  <span className="num w-4 text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{String(item["title"] ?? item["question"] ?? item["author"] ?? item["quote"] ?? f.itemLabel)}</span>
                  <span className="flex gap-0.5" onClick={(e) => e.preventDefault()}>
                    <IconButton size="sm" icon={ArrowUp} label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton size="sm" icon={ArrowDown} label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)} />
                    <IconButton size="sm" icon={Trash2} tone="danger" label={`Remove ${f.itemLabel.toLowerCase()}`} disabled={list.length <= 1} onClick={() => onChange(list.filter((_, j) => j !== i))} />
                  </span>
                </summary>
                <div className="border-t border-line p-3">
                  <FieldList fields={f.fields} value={item} onPatch={(patch) => onChange(list.map((x, j) => (j === i ? Object.fromEntries(Object.entries({ ...x, ...patch }).filter(([, v]) => v !== null)) : x)))} />
                </div>
              </details>
            ))}
            {list.length < f.max && <Btn size="sm" onClick={() => onChange([...list, f.newItem()])}><Plus className="size-3.5" aria-hidden />Add {f.itemLabel.toLowerCase()}</Btn>}
          </div>
        </div>
      );
    }
  }
}
