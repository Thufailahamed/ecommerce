"use client";
import clsx from "clsx";
import { ArrowLeft, ImageIcon, Layers, Package, Plus, Search, Trash2, X } from "lucide-react";
import { useState } from "react";
import { formatMoney, imageUrl, productPath, collectionPath, type Collection, type Image, type Product } from "@convertflow/store-builder";
import { ASSET_BASE } from "@/lib/builder";
import { useBuilder } from "./state";
import { Btn, IconButton, Label, NumberField, PanelSection, Segmented, Switch, TextAreaField, TextField } from "./controls";
import { ImageField } from "./fields";

function Thumb({ src }: { src: string | undefined }) {
  const url = src ? imageUrl(src, ASSET_BASE) : "";
  return (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-ink/[0.04] text-ink-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-4" aria-hidden />}
    </span>
  );
}

function OptionsEditor({ product, onChange }: { product: Product; onChange: (o: Product["options"]) => void }) {
  return (
    <div>
      <Label hint="Size, colour… every choice has the same price">Options</Label>
      <div className="space-y-2">
        {product.options.map((o, i) => (
          <div key={i} className="rounded-lg border border-line p-2.5">
            <div className="flex gap-2">
              <div className="flex-1"><TextField value={o.name} max={30} placeholder="Option name" onChange={(name) => onChange(product.options.map((x, j) => (j === i ? { ...x, name } : x)))} /></div>
              <IconButton icon={Trash2} tone="danger" label="Remove option" onClick={() => onChange(product.options.filter((_, j) => j !== i))} />
            </div>
            <div className="mt-2">
              <TextField value={o.values.join(", ")} placeholder="Values, comma separated" onChange={(v) => onChange(product.options.map((x, j) => (j === i ? { ...x, values: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20) } : x)))} />
            </div>
          </div>
        ))}
        {product.options.length < 3 && <Btn size="sm" onClick={() => onChange([...product.options, { name: product.options.length ? "Colour" : "Size", values: ["Option 1"] }])}><Plus className="size-3.5" aria-hidden />Add option</Btn>}
      </div>
    </div>
  );
}

function ProductEditor({ product, onBack }: { product: Product; onBack: () => void }) {
  const { doc, apply, setPath, canEdit } = useBuilder();
  const set = (props: Record<string, unknown>, key: string) => apply([{ op: "update_product", product: product.id, props }], `product:${product.id}:${key}`);
  const memberOf = doc.collections.filter((c) => c.productIds.includes(product.id));
  return (
    <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <IconButton icon={ArrowLeft} label="Back to products" onClick={onBack} />
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{product.title}</h2>
        <Btn size="sm" variant="ghost" onClick={() => setPath(productPath(product))}>View</Btn>
      </div>
      <fieldset disabled={!canEdit}>
        <PanelSection title="Details">
          <TextField label="Title" value={product.title} max={120} onChange={(v) => set({ title: v }, "title")} />
          <TextAreaField label="Description" value={product.description} max={4000} rows={6} onChange={(v) => set({ description: v }, "desc")} />
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Price" prefix={doc.settings.currency} min={0} step={0.01} value={product.price} onChange={(v) => set({ price: v ?? 0 }, "price")} />
            <NumberField label="Compare-at price" prefix={doc.settings.currency} min={0} step={0.01} value={product.compareAtPrice} onChange={(v) => set({ compareAtPrice: v && v > product.price ? v : null }, "cap")} />
          </div>
          <p className="-mt-1 text-[11px] text-ink-3">Only set a compare-at price for a genuine sale from a price you actually charged.</p>
        </PanelSection>
        <PanelSection title="Images">
          {product.images.map((img, i) => (
            <div key={i} className="relative">
              <ImageField label={i === 0 ? "Main image" : `Image ${i + 1}`} value={img} optional={i > 0}
                onChange={(v) => set({ images: v ? product.images.map((x, j) => (j === i ? v : x)) : product.images.filter((_, j) => j !== i) }, `img${i}`)} />
            </div>
          ))}
          {product.images.length === 0 && <ImageField label="Main image" value={undefined} onChange={(v) => v && set({ images: [v] }, "img0")} />}
          {product.images.length > 0 && product.images.length < 8 && <Btn size="sm" onClick={() => set({ images: [...product.images, { src: "", alt: product.title } satisfies Image] }, "imgadd")}><Plus className="size-3.5" aria-hidden />Add image</Btn>}
        </PanelSection>
        <PanelSection title="Organisation">
          <TextField label="Category" value={product.category ?? ""} max={60} onChange={(v) => set({ category: v || null }, "cat")} />
          <TextField label="Tags" value={product.tags.join(", ")} placeholder="Comma separated" onChange={(v) => set({ tags: v.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12) }, "tags")} />
          <div>
            <Label>Collections</Label>
            <div className="flex flex-wrap gap-1.5">
              {doc.collections.length === 0 && <span className="text-[12px] text-ink-3">No collections yet.</span>}
              {doc.collections.map((c) => {
                const on = memberOf.includes(c);
                return <button key={c.id} type="button" aria-pressed={on} onClick={() => apply([{ op: "update_collection", collection: c.id, props: { productIds: on ? c.productIds.filter((x) => x !== product.id) : [...c.productIds, product.id] } }])}
                  className={clsx("rounded-full border px-2.5 py-1 text-[12px] transition-colors", on ? "border-brand bg-brand-soft text-ink" : "border-line text-ink-3 hover:text-ink")}>{c.title}</button>;
              })}
            </div>
          </div>
          <TextField label="SKU" value={product.sku ?? ""} max={60} onChange={(v) => set({ sku: v || null }, "sku")} />
        </PanelSection>
        <PanelSection title="Options and availability">
          <OptionsEditor product={product} onChange={(options) => set({ options }, "opts")} />
          <Switch label="In stock" checked={product.available} onChange={(v) => set({ available: v }, "avail")} hint="Sold-out products stay visible but can't be added to the cart." />
          <Switch label="Featured" checked={product.featured} onChange={(v) => set({ featured: v }, "feat")} hint="Featured products appear in “Featured products” sections." />
        </PanelSection>
        <div className="p-4"><Btn variant="danger" onClick={() => { apply([{ op: "remove_product", product: product.id }]); onBack(); }}><Trash2 className="size-3.5" aria-hidden />Delete product</Btn></div>
      </fieldset>
    </div>
  );
}

function CollectionEditor({ collection, onBack }: { collection: Collection; onBack: () => void }) {
  const { doc, apply, setPath, canEdit } = useBuilder();
  const set = (props: Record<string, unknown>, key: string) => apply([{ op: "update_collection", collection: collection.id, props }], `col:${collection.id}:${key}`);
  return (
    <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <IconButton icon={ArrowLeft} label="Back to collections" onClick={onBack} />
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{collection.title}</h2>
        <Btn size="sm" variant="ghost" onClick={() => setPath(collectionPath(collection))}>View</Btn>
      </div>
      <fieldset disabled={!canEdit}>
        <PanelSection title="Details">
          <TextField label="Title" value={collection.title} max={80} onChange={(v) => set({ title: v }, "title")} />
          <TextAreaField label="Description" value={collection.description} max={600} rows={3} onChange={(v) => set({ description: v }, "desc")} />
          <ImageField label="Image" value={collection.image} optional onChange={(v) => set({ image: v }, "img")} />
        </PanelSection>
        <PanelSection title={`Products · ${collection.productIds.length}`}>
          <ul className="-mx-1 space-y-0.5">
            {doc.products.map((p) => {
              const on = collection.productIds.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]">
                    <input type="checkbox" checked={on} className="accent-[var(--brand-solid)]" onChange={() => set({ productIds: on ? collection.productIds.filter((x) => x !== p.id) : [...collection.productIds, p.id] }, "products")} />
                    <Thumb src={p.images[0]?.src} />
                    <span className="truncate text-[13px] text-ink-2">{p.title}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </PanelSection>
        <div className="p-4"><Btn variant="danger" onClick={() => { apply([{ op: "remove_collection", collection: collection.id }]); onBack(); }}><Trash2 className="size-3.5" aria-hidden />Delete collection</Btn></div>
      </fieldset>
    </div>
  );
}

export function ProductsPanel() {
  const { doc, apply, canEdit } = useBuilder();
  const [view, setView] = useState<"products" | "collections">("products");
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const product = view === "products" && openId ? doc.products.find((p) => p.id === openId) : undefined;
  const collection = view === "collections" && openId ? doc.collections.find((c) => c.id === openId) : undefined;
  if (product) return <ProductEditor product={product} onBack={() => setOpenId(null)} />;
  if (collection) return <CollectionEditor collection={collection} onBack={() => setOpenId(null)} />;

  const addProduct = () => {
    const r = apply([{ op: "add_product", product: { title: "New product", price: 25, description: "", images: [{ src: "", alt: "New product" }] } }]);
    if (r.applied[0]) setOpenId(r.applied[0].target);
  };
  const addCollection = () => {
    const r = apply([{ op: "add_collection", collection: { title: "New collection", description: "" } }]);
    if (r.applied[0]) setOpenId(r.applied[0].target);
  };
  const products = doc.products.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase()) || p.category?.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line p-3">
        <Segmented value={view} onChange={(v) => { setView(v); setOpenId(null); }} options={[{ value: "products", label: `Products · ${doc.products.length}`, icon: Package }, { value: "collections", label: `Collections · ${doc.collections.length}`, icon: Layers }]} />
        {view === "products" && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-8 w-full rounded-lg border border-line bg-ink/[0.03] pl-8 pr-7 text-[12px] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none" />
            {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"><X className="size-3.5" /></button>}
          </div>
        )}
      </div>
      <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {view === "products" ? (
          products.length === 0 ? <p className="p-4 text-center text-[12px] text-ink-3">{doc.products.length ? "No products match." : "No products yet. Add one, or ask the AI to draft a catalogue."}</p> : (
            <ul className="space-y-0.5">
              {products.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpenId(p.id)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-ink/[0.04]">
                    <Thumb src={p.images[0]?.src} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{p.title}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                        <span className="num">{formatMoney(p.price, doc.settings.currency)}</span>
                        {!p.available && <span className="text-warn">· Sold out</span>}
                        {p.featured && <span>· Featured</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          doc.collections.length === 0 ? <p className="p-4 text-center text-[12px] text-ink-3">Collections group products, like “Mugs” or “Gift sets”.</p> : (
            <ul className="space-y-0.5">
              {doc.collections.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setOpenId(c.id)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-ink/[0.04]">
                    <Thumb src={c.image?.src || doc.products.find((p) => p.id === c.productIds[0])?.images[0]?.src} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{c.title}</span>
                      <span className="text-[11px] text-ink-3">{c.productIds.length} product{c.productIds.length === 1 ? "" : "s"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      {canEdit && (
        <div className="border-t border-line p-3">
          <Btn variant="primary" className="w-full" onClick={view === "products" ? addProduct : addCollection}><Plus className="size-4" aria-hidden />{view === "products" ? "Add product" : "Add collection"}</Btn>
        </div>
      )}
    </div>
  );
}
