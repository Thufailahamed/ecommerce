"use client";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, History, Layers, Monitor, Palette, Rocket, Settings2, ShieldCheck, Smartphone, Sparkles, Tag, Target, Trash2, X, FlaskConical, type LucideIcon } from "lucide-react";
import { CampaignConfig, type Condition } from "@convertflow/contracts";
import { describeRuleGroup } from "@convertflow/campaign-engine";
import { api, ApiError, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { TOOLS } from "@/lib/tools";
import { defaultConfig, type EditorTool } from "@/lib/campaign-defaults";
import { fromLocalDateTimeInput, toLocalDateTimeInput } from "@/lib/local-datetime";
import { Badge, Button, ErrorNote, Field, Input, Select, Textarea, statusTone } from "./ui";
import { SMS_COUNTRIES } from "@convertflow/storefront-sdk";
import { CampaignPreview, type Device } from "./campaign-preview";
import { VersionHistory } from "./version-history";

type Cfg = CampaignConfig;

export { defaultConfig, type EditorTool };

type RecOptions = NonNullable<Cfg["recommend"]>;

const TOAST_KINDS: { id: NonNullable<Cfg["toast"]>["kind"]; label: string; hint: string }[] = [
  { id: "announcement", label: "Announcement", hint: "A short message with a button." },
  { id: "product_offer", label: "Product offer", hint: "Shows the first product you pick below, with its image." },
  { id: "coupon", label: "Coupon reveal", hint: "Hides the code until the shopper asks for it. Needs a discount code below." },
  { id: "shipping_incentive", label: "Shipping incentive", hint: "Tells shoppers how far their real cart is from free shipping. Only shows when the cart is known and still short." },
];

const REC_SOURCES: { id: RecOptions["source"]; label: string; hint: string }[] = [
  { id: "same_collection", label: "Same collection", hint: "Other products from the viewed product's collection, or from the collections you list. Needs collections in your catalog." },
  { id: "manual", label: "Products I pick", hint: "Exactly these products, whenever they are in stock." },
  { id: "complements", label: "Goes well with", hint: "Products you link as complements on the Upsells page, for the product being viewed (or what is in the cart)." },
  { id: "shipping_threshold", label: "Closes the free-shipping gap", hint: "Products that bring the shopper's real cart up to free shipping. Only shows when the cart is known and still short." },
  { id: "alternatives", label: "Alternatives when sold out", hint: "Products you link as alternatives, shown only on a product your catalog says is out of stock." },
];

const REC_PLACEMENTS: { id: RecOptions["placement"]; label: string; hint: string }[] = [
  { id: "product_page", label: "On the product page", hint: "A block inside the page. Put <div data-convertflow-recommendations></div> where you want it; otherwise it goes at the end of the main content." },
  { id: "cart", label: "On the cart", hint: "A block on the cart page. Mark the spot with data-convertflow-recommendations=\"cart\", or it goes at the end of the main content." },
  { id: "toast", label: "As a toast", hint: "A small card in the corner, shown as a list, when its trigger fires." },
];

const PAGE_TYPE_OPTIONS = [
  { value: "home", label: "Home" }, { value: "collection", label: "Collection" }, { value: "product", label: "Product" },
  { value: "cart", label: "Cart" }, { value: "checkout", label: "Checkout" }, { value: "search", label: "Search" },
  { value: "content", label: "Content" }, { value: "other", label: "Other" },
] as const;
const DEVICE_OPTIONS = [{ value: "mobile", label: "Mobile" }, { value: "tablet", label: "Tablet" }, { value: "desktop", label: "Desktop" }] as const;

const RULE_FIELDS: { id: string; label: string; make: () => Condition }[] = [
  { id: "page_type", label: "Page type", make: () => ({ field: "page_type", op: "in", value: ["product"] }) },
  { id: "device", label: "Device", make: () => ({ field: "device", op: "in", value: ["mobile"] }) },
  { id: "cart_subtotal", label: "Cart subtotal", make: () => ({ field: "cart_subtotal", op: "gte", value: 50 }) },
  { id: "cart_item_count", label: "Cart items", make: () => ({ field: "cart_item_count", op: "gte", value: 1 }) },
  { id: "product_id", label: "Product", make: () => ({ field: "product_id", op: "in", value: [] }) },
  { id: "collection_id", label: "Collection", make: () => ({ field: "collection_id", op: "in", value: [] }) },
  { id: "visitor_type", label: "Visitor type", make: () => ({ field: "visitor_type", op: "equals", value: "new" }) },
  { id: "url_path", label: "URL path", make: () => ({ field: "url_path", op: "starts_with", value: "/collections/" }) },
  { id: "pages_viewed", label: "Pages viewed", make: () => ({ field: "pages_viewed", op: "gte", value: 3 }) },
  { id: "product_available", label: "Product availability", make: () => ({ field: "product_available", op: "equals", value: false }) },
];

interface ProductOption { id: string; title: string }

/** A small multi-select that works with the contract's arrays (page type and device allow more than one value). */
function ChoiceChips({ label, options, values, onChange }: { label: string; options: readonly { value: string; label: string }[]; values: string[]; onChange(values: string[]): void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on}
            onClick={() => onChange(on ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ${on ? "bg-brand-solid text-white ring-brand-tint" : "bg-ink/[0.03] text-ink-2 ring-line hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Comma-separated ids, kept as text while typing so a trailing comma is not swallowed. */
function CsvListInput({ label, values, onChange, hint }: { label: string; values: string[]; onChange(values: string[]): void; hint?: string }) {
  const joined = values.join(", ");
  const [text, setText] = useState(joined);
  useEffect(() => { setText(joined); }, [joined]);
  return (
    <div className="min-w-0 flex-1">
      <Input aria-label={label} value={text} placeholder="id-1, id-2" onChange={(e) => {
        const next = e.target.value;
        setText(next);
        onChange(next.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50));
      }} onBlur={() => setText(joined)} />
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function ProductCondition({ c, products, onChange }: { c: Extract<Condition, { field: "product_id" }>; products: ProductOption[]; onChange(c: Condition): void }) {
  const selected = c.value;
  const available = products.filter((p) => !selected.includes(p.id));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {selected.map((id) => {
        const title = products.find((p) => p.id === id)?.title ?? id;
        return (
          <span key={id} className="inline-flex max-w-[13rem] items-center gap-1 rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line">
            <span className="truncate" title={title}>{title}</span>
            <button type="button" aria-label={`Remove product ${title}`} className="text-ink-3 hover:text-danger" onClick={() => onChange({ ...c, value: selected.filter((x) => x !== id) })}><X className="size-3" /></button>
          </span>
        );
      })}
      {products.length > 0 ? (
        <Select aria-label="Add product" className="w-48" value="" onChange={(e) => {
          const id = e.target.value;
          if (id && !selected.includes(id)) onChange({ ...c, value: [...selected, id] });
        }}>
          <option value="">+ Add a product…</option>
          {available.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
      ) : (
        <CsvListInput label="Product ids" values={selected} hint="Import products in Settings to pick them by name, or paste catalog ids here." onChange={(value) => onChange({ ...c, value })} />
      )}
    </div>
  );
}

function ConditionRow({ c, products = [], onChange, onRemove }: { c: Condition; products?: ProductOption[]; onChange(c: Condition): void; onRemove(): void }) {
  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-line py-2 text-sm">
      <span className="w-28 shrink-0 pt-2 font-medium">{RULE_FIELDS.find((f) => f.id === c.field)?.label ?? c.field}</span>
      {c.field === "page_type" && (<>
        <Select aria-label="Operator" className="w-24" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "in" | "not_in" })}><option value="in">is</option><option value="not_in">is not</option></Select>
        <ChoiceChips label="Page type" options={PAGE_TYPE_OPTIONS} values={c.value} onChange={(value) => onChange({ ...c, value: value as typeof c.value })} />
      </>)}
      {c.field === "device" && (<>
        <Select aria-label="Operator" className="w-24" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "in" | "not_in" })}><option value="in">is</option><option value="not_in">is not</option></Select>
        <ChoiceChips label="Device" options={DEVICE_OPTIONS} values={c.value} onChange={(value) => onChange({ ...c, value: value as typeof c.value })} />
      </>)}
      {c.field === "cart_subtotal" && (<>
        <Select aria-label="Operator" className="w-28" value={c.op} onChange={(e) => {
          const op = e.target.value as "gte" | "lte" | "between";
          onChange(op === "between" ? { ...c, op, valueTo: c.valueTo ?? c.value } : { field: "cart_subtotal", op, value: c.value });
        }}><option value="gte">at least</option><option value="lte">at most</option><option value="between">between</option></Select>
        <Input aria-label="Amount" type="number" min={0} className="w-28" value={c.value} onChange={(e) => { const value = Math.max(0, Number(e.target.value)); onChange({ ...c, value, ...(c.op === "between" && c.valueTo === undefined ? { valueTo: value } : {}) }); }} />
        {c.op === "between" && <>
          <span className="pt-2 text-ink-3">and</span>
          <Input aria-label="Upper amount" type="number" min={0} className="w-28" value={c.valueTo ?? ""} onChange={(e) => onChange({ ...c, valueTo: Math.max(0, Number(e.target.value)) })} />
        </>}
      </>)}
      {c.field === "cart_item_count" && (<>
        <Select aria-label="Operator" className="w-28" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "gte" | "lte" })}><option value="gte">at least</option><option value="lte">at most</option></Select>
        <Input aria-label="Items" type="number" min={0} className="w-24" value={c.value} onChange={(e) => onChange({ ...c, value: Math.max(0, Math.floor(Number(e.target.value))) })} />
      </>)}
      {c.field === "product_id" && (<>
        <Select aria-label="Operator" className="w-24" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "in" | "not_in" })}><option value="in">is</option><option value="not_in">is not</option></Select>
        <ProductCondition c={c} products={products} onChange={onChange} />
      </>)}
      {c.field === "collection_id" && (<>
        <Select aria-label="Operator" className="w-24" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "in" | "not_in" })}><option value="in">is</option><option value="not_in">is not</option></Select>
        <CsvListInput label="Collection ids" values={c.value} hint="Catalog collection ids, separated by commas." onChange={(value) => onChange({ ...c, value })} />
      </>)}
      {c.field === "visitor_type" && (
        <Select aria-label="Visitor" className="w-36" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value as "new" | "returning" })}><option>new</option><option>returning</option></Select>
      )}
      {c.field === "url_path" && (<>
        <Select aria-label="Operator" className="w-32" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "equals" | "starts_with" | "contains" })}><option value="equals">equals</option><option value="starts_with">starts with</option><option value="contains">contains</option></Select>
        <Input aria-label="Path" className="w-48" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
      </>)}
      {c.field === "pages_viewed" && (<><span className="pt-2 text-ink-2">at least</span><Input aria-label="Pages" type="number" min={1} className="w-20" value={c.value} onChange={(e) => onChange({ ...c, value: Math.max(1, Number(e.target.value)) })} /></>)}
      {c.field === "product_available" && (
        <Select aria-label="Product availability" className="w-40" value={c.value ? "true" : "false"} onChange={(e) => onChange({ ...c, value: e.target.value === "true" })}><option value="true">In stock</option><option value="false">Out of stock</option></Select>
      )}
      <button type="button" aria-label="Remove rule" className="ml-auto pt-2 text-ink-3 hover:text-danger" onClick={onRemove}><Trash2 className="size-4" /></button>
    </div>
  );
}

/** One group of controls inside a builder panel. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="space-y-4 border-b border-line px-5 py-5 last:border-b-0"><h2 className="font-display text-xs font-bold uppercase tracking-[0.14em]">{title}</h2><div className="space-y-4">{children}</div></section>;
}

type TabId = "content" | "design" | "audience" | "display" | "offer" | "test" | "history";
const TABS: { id: TabId; label: string; icon: LucideIcon; hint: string }[] = [
  { id: "content", label: "Content", icon: Layers, hint: "What the shopper reads and clicks" },
  { id: "design", label: "Design", icon: Palette, hint: "Colours and shape" },
  { id: "audience", label: "Targeting", icon: Target, hint: "Who it shows to, and where" },
  { id: "display", label: "Display", icon: Settings2, hint: "When it appears, how often, and for how long" },
  { id: "offer", label: "Offer", icon: Tag, hint: "An optional discount code" },
  { id: "test", label: "Test", icon: FlaskConical, hint: "Measure the real effect with a control group" },
  { id: "history", label: "History", icon: History, hint: "Published versions you can roll back to" },
];

/**
 * Full-screen builder, rendered straight under <body>. The app shell animates its page wrapper with a transform,
 * which would otherwise become the containing block of a position:fixed child and squash the builder. While it
 * is open the rest of the page is inert, so keyboard focus and screen readers cannot wander into the hidden app.
 */
function BuilderHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const behind = Array.from(document.body.children).filter((c) => c !== el && !c.hasAttribute("inert"));
    behind.forEach((c) => c.setAttribute("inert", ""));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setHost(el);
    return () => { behind.forEach((c) => c.removeAttribute("inert")); document.body.style.overflow = overflow; el.remove(); };
  }, []);
  return host ? createPortal(children, host) : null;
}

/** Right-hand drawer where the merchant reviews and approves before anything goes live. */
function LaunchDrawer({ open, onClose, children }: { open: boolean; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close review" tabIndex={-1} className="absolute inset-0 bg-[#0a0c14]/45 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="launch-h" tabIndex={-1} className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl outline-none">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="launch-h" className="font-display text-sm font-bold uppercase tracking-[0.14em]">Review and launch</h2>
          <button type="button" aria-label="Close" className="rounded-lg p-1.5 text-ink-2 hover:bg-ink/[0.06] hover:text-ink" onClick={onClose}><X className="size-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

export function CampaignEditor({ store, campaign, initial, tool }: { store: Store; campaign?: CampaignRow; initial?: unknown; tool?: EditorTool }) {
  const router = useRouter();
  const parsedInitial = CampaignConfig.safeParse(initial ?? campaign?.draftConfig);
  const [cfg, setCfg] = useState<Cfg>(parsedInitial.success ? parsedInitial.data : defaultConfig(tool));
  const isToast = cfg.tool === "toast";
  const isFeed = cfg.tool === "feed";
  const isEmail = cfg.tool === "email" && cfg.format !== "restock"; // legacy back-in-stock forms keep the classic editor
  const isSms = cfg.tool === "sms";
  const isForm = isEmail || isSms;
  const isUpsell = cfg.tool === "upsell";
  // What the merchant is typing, kept apart from the saved value: parsing on every keystroke would swallow a trailing comma or an emptied number.
  const [collectionsText, setCollectionsText] = useState(() => cfg.recommend?.collectionIds.join(", ") ?? "");
  const [countText, setCountText] = useState(() => String(cfg.recommend?.maxProducts ?? 3));
  /** An inline recommendation block is part of the page, like the feed: no trigger, per-visit caps or dismissal. */
  const passiveUpsell = isUpsell && cfg.recommend?.placement !== "toast";
  /** An inline signup form sits in the page like the feed and inline recommendations: no trigger, per-visit caps or dismissal. */
  const passiveForm = isForm && cfg.format === "inline";
  const [row, setRow] = useState(campaign);
  const [device, setDevice] = useState<Device>("desktop");
  const [busy, setBusy] = useState<null | "save" | "publish">(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [dirty, setDirty] = useState(!campaign);
  const [tab, setTab] = useState<TabId>("content");
  const [pane, setPane] = useState<"edit" | "preview">("edit");
  const [launching, setLaunching] = useState(false);

  const base = `/api/v1/stores/${store.id}/campaigns`;
  const catalog = useApi<{ id: string; externalId: string; title: string; url: string | null; handle: string | null; imageUrl: string | null }[]>(`/api/v1/stores/${store.id}/products`);
  const guard = useApi<{ maxDiscountPercent: number | null }>(`/api/v1/stores/${store.id}/integration`);
  const productOptions = useMemo(() => (catalog.data ?? []).map((p) => ({ id: p.externalId, title: p.title })), [catalog.data]);
  const patch = (fn: (c: Cfg) => Cfg) => { setCfg(fn); setDirty(true); setApproved(false); };
  const summary = useMemo(() => describeRuleGroup(cfg.targeting), [cfg.targeting]);
  const check = CampaignConfig.safeParse(cfg);
  const warnings = useMemo(() => {
    const w: string[] = [];
    if (cfg.targeting.conditions.length === 0) w.push("No targeting rules: shows to every visitor on every page.");
    if (cfg.trigger.type === "immediate" && cfg.format === "popup") w.push("A popup that opens immediately can hurt the experience.");
    if (isToast && cfg.toast?.kind === "coupon" && !cfg.promotion) w.push("Add a discount code below, or this coupon toast has nothing to reveal.");
    if (isToast && cfg.trigger.type === "exit_intent") w.push("Exit intent only works on desktop with a mouse.");
    if (isEmail && cfg.form && !/unsubscribe|opt[- ]?out/i.test(cfg.form.consentText)) w.push("Your consent text does not mention that shoppers can unsubscribe.");
    if (isSms && cfg.form && !/rates/i.test(cfg.form.consentText)) w.push("SMS consent text usually says that message and data rates may apply.");
    if (isUpsell && cfg.recommend) {
      if (catalog.data && catalog.data.length === 0) w.push("Your catalog is empty. Recommendations only use products from your catalog, with their real prices and stock, so nothing will show until you import or sync it.");
      if (cfg.recommend.placement === "cart" && !cfg.targeting.conditions.some((x) => x.field === "page_type" || x.field === "cart_item_count" || x.field === "cart_subtotal")) w.push("A cart block should target the cart page or a cart rule, otherwise it may appear where there is no cart.");
      if (cfg.recommend.addToCart && store.platform === "custom") w.push("On a custom store, products can only be added without leaving the page if your site provides ConvertFlow.addToCart. Without it they link to the product page.");
      if (cfg.recommend.source === "alternatives") w.push("Alternatives only show on a product your catalog says is out of stock, so keep your stock levels synced.");
    }
    return w;
  }, [cfg, isToast, isEmail, isSms, isUpsell, catalog.data, store.platform]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError) { setError(e.message); setIssues(Array.isArray(e.details) ? e.details.map((d) => typeof d === "string" ? d : JSON.stringify(d)) : []); }
    else setError("Something went wrong. Try again.");
  };

  /**
   * `navigate` moves to the saved campaign's page (a remount). When publishing we do NOT touch the URL until the
   * publish succeeds: any URL change remounts the page (the app shell keys it by path), which would throw away the
   * error message if the server rejects the publish. The saved draft is kept in `row`, so retrying updates it.
   */
  async function save(navigate = true): Promise<CampaignRow | null> {
    setBusy("save"); setError(null); setIssues([]);
    try {
      const r = row ? await api<CampaignRow>(`${base}/${row.id}`, { method: "PUT", body: cfg }) : await api<CampaignRow>(base, { method: "POST", body: cfg });
      setRow(r); setDirty(false);
      if (!row && navigate) router.replace(`/app/campaigns/${r.id}`);
      return r;
    } catch (e) { fail(e); return null; } finally { setBusy(null); }
  }

  async function publish() {
    const wasNew = !row;
    const saved = dirty || !row ? await save(false) : row;
    if (!saved) return;
    setBusy("publish"); setError(null);
    try {
      await api(`${base}/${saved.id}/publish`, { method: "POST", body: { approve: true, approvedUpdatedAt: saved.updatedAt } });
      const fresh = await api<CampaignRow>(`${base}/${saved.id}`);
      setRow(fresh); setApproved(false); setLaunching(false);
      if (wasNew) router.replace(`/app/campaigns/${saved.id}`); // now it is live: show the full page with version history
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  const isLive = row?.status === "active" || row?.status === "scheduled";

  const tabs = TABS.filter((t) => (t.id !== "offer" || !isUpsell) && (t.id !== "history" || !!row));
  const current = tabs.some((t) => t.id === tab) ? tab : "content";
  const meta = TABS.find((t) => t.id === current)!;
  const toolName = cfg.tool ? TOOLS[cfg.tool].name : "Campaign";
  const issueCount = check.success ? 0 : check.error.issues.length;
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.findIndex((t) => t.id === current);
    const next = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length]!;
    setTab(t.id);
    document.getElementById(`tab-${t.id}`)?.focus();
  };
  const panel = (id: TabId, children: ReactNode) => <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={current !== id}>{children}</div>;

  return (
    <BuilderHost><div className="fixed inset-0 z-40 flex flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface/80 px-3 py-2 backdrop-blur sm:px-4">
        <Link href="/app/campaigns" aria-label="Back to campaigns" onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault(); }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-ink-2 transition-colors hover:bg-ink/[0.06] hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /><span className="hidden sm:inline">Campaigns</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-line sm:block" />
        <span className="hidden text-sm text-ink-3 md:inline">{toolName}</span>
        <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto sm:max-w-sm sm:flex-1">
          <Input aria-label="Campaign name" value={cfg.name} onChange={(e) => patch((c) => ({ ...c, name: e.target.value }))} className="h-9 min-w-0 flex-1 font-medium" />
          <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-ink/[0.02] p-0.5 lg:hidden" role="group" aria-label="View">
            <button type="button" aria-pressed={pane === "edit"} onClick={() => setPane("edit")} className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium ${pane === "edit" ? "bg-brand-solid text-white" : "text-ink-2"}`}>Edit</button>
            <button type="button" aria-pressed={pane === "preview"} onClick={() => setPane("preview")} className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium ${pane === "preview" ? "bg-brand-solid text-white" : "text-ink-2"}`}><Eye className="size-3.5" aria-hidden />Preview</button>
          </div>
        </div>
        {row && <Badge tone={statusTone(row.status)} dot>{row.status}</Badge>}
        <span className="num hidden text-xs text-ink-3 md:inline" role="status">{busy === "save" ? "Saving…" : row && !dirty ? "Saved" : dirty ? "Unsaved changes" : ""}</span>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 rounded-full border border-line bg-ink/[0.02] p-0.5 sm:flex" role="group" aria-label="Device">
            <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${device === "desktop" ? "bg-brand-solid text-white" : "text-ink-2 hover:text-ink"}`}><Monitor className="size-4" aria-hidden />Desktop</button>
            <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${device === "mobile" ? "bg-brand-solid text-white" : "text-ink-2 hover:text-ink"}`}><Smartphone className="size-4" aria-hidden />Mobile</button>
          </div>
          <Button className="h-9 px-3 text-xs sm:px-5 sm:text-sm" onClick={() => void save()} busy={busy === "save"} disabled={!check.success || !dirty}>{row ? "Save draft" : "Create draft"}</Button>
          <Button variant="primary" className="h-9 px-3 text-xs sm:px-5 sm:text-sm" onClick={() => setLaunching(true)} disabled={!check.success}><Rocket className="size-4" aria-hidden />{isLive ? "Update" : "Launch"}</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-line bg-surface/60 p-1.5 lg:w-[84px] lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-2">
          <div className="flex flex-1 flex-row gap-1 lg:flex-none lg:flex-col" role="tablist" aria-label="Editor sections" aria-orientation="vertical">
          {tabs.map((t) => {
            const on = t.id === current;
            return (
              <button key={t.id} id={`tab-${t.id}`} role="tab" type="button" aria-selected={on} aria-controls={`panel-${t.id}`} tabIndex={on ? 0 : -1} onKeyDown={onTabKey} onClick={() => { setTab(t.id); setPane("edit"); }}
                className={`relative flex min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors lg:flex-none ${on ? "bg-brand-soft text-ink ring-1 ring-brand-tint" : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"}`}>
                <t.icon className={`size-5 ${on ? "text-brand" : ""}`} aria-hidden />{t.label}
                {t.id === "audience" && cfg.targeting.conditions.length === 0 && <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-warn" />}
              </button>
            );
          })}
          </div>
          <Link href="/app/studio" className="flex min-w-[4.25rem] flex-none flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink lg:mt-auto lg:flex-none"
            onClick={(e) => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) e.preventDefault(); }}>
            <Sparkles className="size-5 text-brand" aria-hidden />AI Chat
          </Link>
        </div>

        <div className={`${pane === "edit" ? "block" : "hidden"} min-h-0 flex-1 overflow-y-auto border-line bg-surface lg:block lg:w-[400px] lg:flex-none lg:border-r`}>
          <div className="sticky top-0 z-10 border-b border-line bg-surface/95 px-5 py-4 backdrop-blur">
            <p className="font-display text-sm font-bold uppercase tracking-[0.14em]">{meta.label}</p>
            <p className="mt-1 text-xs text-ink-3">{meta.hint}</p>
          </div>

        {panel("content", <>
        <Section title="Format and message">
          {!isToast && !isFeed && !isForm && !isUpsell && <Field label="Format"><Select value={cfg.format} onChange={(e) => {
            const format = e.target.value as Cfg["format"];
            patch((c) => format === "restock" && c.format !== "restock"
              ? { ...c, format, creative: { ...c.creative, headline: "Notify me when it's back", body: "Leave your email and we'll tell you once.", ctaLabel: "Notify me", ctaUrl: "/" },
                  targeting: c.targeting.conditions.length ? c.targeting : { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }, { field: "product_available", op: "equals", value: false }] } }
              : { ...c, format });
          }}><option value="popup">Popup</option><option value="slide_in">Slide-in</option><option value="announcement_bar">Announcement bar</option><option value="restock">Back-in-stock form (Growth)</option></Select></Field>}
          {cfg.format === "restock" && <p className="text-xs text-ink-3">Shoppers enter their email and confirm by email. When the product returns to stock they get one alert. Your page must provide the product id via <code className="num">window.ConvertFlowContext</code>.</p>}
          <Field label="Headline"><Input value={cfg.creative.headline} maxLength={90} onChange={(e) => patch((c) => ({ ...c, creative: { ...c.creative, headline: e.target.value } }))} /></Field>
          <Field label="Body"><Textarea rows={2} maxLength={280} value={cfg.creative.body} onChange={(e) => patch((c) => ({ ...c, creative: { ...c.creative, body: e.target.value } }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={isUpsell ? "Add button label" : "Button label"}><Input value={cfg.creative.ctaLabel} maxLength={32} onChange={(e) => patch((c) => ({ ...c, creative: { ...c.creative, ctaLabel: e.target.value } }))} /></Field>
            {!isForm && !isUpsell && <Field label="Button link" hint="Path or https URL"><Input value={cfg.creative.ctaUrl} onChange={(e) => patch((c) => ({ ...c, creative: { ...c.creative, ctaUrl: e.target.value } }))} /></Field>}
          </div>
        </Section>

        {isUpsell && cfg.recommend && (
          <Section title="Recommendations">
            <p className="text-xs text-ink-3">Products come from your catalog at the moment a shopper sees the block, so prices and stock are always current. Only products your catalog says are in stock are ever shown, and nothing is guessed from shopper behaviour.</p>
            <Field label="Which products" hint={REC_SOURCES.find((s) => s.id === cfg.recommend?.source)?.hint ?? ""}>
              <Select value={cfg.recommend.source} onChange={(e) => {
                const source = e.target.value as RecOptions["source"];
                patch((c) => { const { freeShippingThreshold: _f, ...r } = c.recommend!; return { ...c, recommend: { ...r, source, ...(source === "shipping_threshold" ? { freeShippingThreshold: c.recommend?.freeShippingThreshold ?? 75 } : {}) } }; });
              }}>{REC_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
            </Field>
            {cfg.recommend.source === "shipping_threshold" && (
              <Field label={`Free-shipping threshold (${store.currency})`} hint="Your store's real free-shipping minimum. The gap is calculated from each shopper's cart.">
                <Input type="number" min={1} value={cfg.recommend.freeShippingThreshold ?? ""} onChange={(e) => { const n = Number(e.target.value); patch((c) => { const { freeShippingThreshold: _t, ...r } = c.recommend!; return { ...c, recommend: n > 0 ? { ...r, freeShippingThreshold: n } : r }; }); }} />
              </Field>
            )}
            {cfg.recommend.source === "same_collection" && (
              <Field label="Collections (optional)" hint="Collection ids from your catalog, separated by commas. Leave empty to use the collections of the product being viewed.">
                <Input aria-label="Collections" value={collectionsText} onChange={(e) => { setCollectionsText(e.target.value); const ids = e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20); patch((c) => ({ ...c, recommend: { ...c.recommend!, collectionIds: ids } })); }} />
              </Field>
            )}
            {cfg.recommend.source === "manual" && (<>
              {cfg.recommend.productIds.map((pid) => {
                const name = catalog.data?.find((x) => x.externalId === pid)?.title ?? pid;
                return (
                  <div key={pid} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm"><span className="truncate">{name}</span>
                    <button type="button" aria-label={`Remove ${name}`} className="text-ink-3 hover:text-danger" onClick={() => patch((c) => ({ ...c, recommend: { ...c.recommend!, productIds: c.recommend!.productIds.filter((x) => x !== pid) } }))}><Trash2 className="size-4" /></button></div>
                );
              })}
              {cfg.recommend.productIds.length < 50 && (
                <Select aria-label="Add a recommended product" value="" onChange={(e) => {
                  const id = e.target.value; if (!id) return;
                  patch((c) => c.recommend!.productIds.includes(id) ? c : ({ ...c, recommend: { ...c.recommend!, productIds: [...c.recommend!.productIds, id] } }));
                }}>
                  <option value="">{catalog.data?.length ? "+ Add a product…" : "Import products in Settings first"}</option>
                  {catalog.data?.map((p) => <option key={p.id} value={p.externalId}>{p.title}</option>)}
                </Select>
              )}
            </>)}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Where" hint={REC_PLACEMENTS.find((p) => p.id === cfg.recommend?.placement)?.hint ?? ""}>
                <Select aria-label="Placement" value={cfg.recommend.placement} onChange={(e) => {
                  const placement = e.target.value as RecOptions["placement"];
                  patch((c) => {
                    const cs = c.targeting.conditions;
                    const untouched = cs.length === 0 || (cs.length === 1 && cs[0]!.field === "page_type"); // only replace targeting the merchant has not customised
                    const page = (t: "product" | "cart"): Condition => ({ field: "page_type", op: "in", value: [t] });
                    return {
                      ...c, recommend: { ...c.recommend!, placement },
                      targeting: untouched ? { ...c.targeting, conditions: placement === "toast" ? [] : [page(placement === "cart" ? "cart" : "product")] } : c.targeting,
                      trigger: placement === "toast" ? (c.trigger.type === "immediate" ? { type: "delay", seconds: 5 } : c.trigger) : { type: "immediate" },
                    };
                  });
                }}>{REC_PLACEMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
              </Field>
              <Field label="Layout" hint={cfg.recommend.placement === "toast" ? "A toast always shows a list." : ""}>
                <Select aria-label="Layout" value={cfg.recommend.layout} disabled={cfg.recommend.placement === "toast"} onChange={(e) => patch((c) => ({ ...c, recommend: { ...c.recommend!, layout: e.target.value as RecOptions["layout"] } }))}>
                  <option value="row">Row</option><option value="grid">Grid</option><option value="list">List</option>
                </Select>
              </Field>
              <Field label="How many (1–6)"><Input type="number" min={1} max={6} value={countText}
                onChange={(e) => { setCountText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 6) patch((c) => ({ ...c, recommend: { ...c.recommend!, maxProducts: n } })); }}
                onBlur={() => setCountText(String(cfg.recommend?.maxProducts ?? 3))} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.recommend.showPrice} onChange={(e) => patch((c) => ({ ...c, recommend: { ...c.recommend!, showPrice: e.target.checked } }))} />Show prices</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.recommend.addToCart} onChange={(e) => patch((c) => ({ ...c, recommend: { ...c.recommend!, addToCart: e.target.checked } }))} />Let shoppers add to cart from here</label>
            <p className="text-xs text-ink-3">Products with several variants always open their page so the shopper can choose options. The preview uses labelled sample products.</p>
          </Section>
        )}

        {isForm && cfg.form && (
          <Section title={isSms ? "SMS signup" : "Email signup"}>
            <Field label="Style" hint={cfg.format === "inline" ? "Appears in the page where you put an element with the attribute data-convertflow-form, or at the end of the main content if there is none. It is not triggered: it is simply part of the page." : cfg.format === "announcement_bar" ? "A slim bar along the top or bottom edge." : undefined}>
              <Select value={cfg.format} onChange={(e) => patch((c) => ({ ...c, format: e.target.value as Cfg["format"] }))}><option value="popup">Popup</option><option value="slide_in">Slide-in</option><option value="announcement_bar">Announcement bar</option><option value="inline">Inline (in the page)</option></Select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.form.collect.firstName} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, collect: { ...c.form!.collect, firstName: e.target.checked } } }))} />Also ask for a first name (optional for the shopper)</label>
            {isSms && (
              <Field label="Default country" hint="Pre-selects the dial code. Shoppers can pick another country or type a full international number.">
                <Select aria-label="Default country" value={cfg.form.defaultCountry} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, defaultCountry: e.target.value } }))}>
                  {Object.keys(SMS_COUNTRIES).map((iso) => <option key={iso} value={iso}>{iso} (+{SMS_COUNTRIES[iso]![0]})</option>)}
                </Select>
              </Field>
            )}
            <Field label="Consent text" hint={isSms
              ? "Shown next to an unticked checkbox and saved with every signup as proof of consent. It must say how to opt out (Reply STOP); most carriers also expect the message frequency and that message and data rates may apply."
              : "Shown next to an unticked checkbox. The exact words are saved with every signup as proof of consent, so say what they will receive and that they can unsubscribe."}>
              <Textarea rows={isSms ? 5 : 3} maxLength={600} value={cfg.form.consentText} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, consentText: e.target.value } }))} />
            </Field>
            <Field label="Privacy policy link" hint="Path or https URL"><Input value={cfg.form.privacyUrl} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, privacyUrl: e.target.value } }))} /></Field>
            {isSms
              ? <Field label="Message once the number is confirmed" hint="Shoppers always confirm their number with a code we text them before they are subscribed."><Input maxLength={160} value={cfg.form.successMessage} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, successMessage: e.target.value } }))} /></Field>
              : <Field label="Message after signing up" hint="Shoppers always confirm from their inbox first (double opt-in)."><Input maxLength={160} value={cfg.form.pendingMessage} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, pendingMessage: e.target.value } }))} /></Field>}
            <p className="rounded-xl border border-brand-tint bg-brand-soft px-4 py-3 text-xs leading-relaxed">{isSms
              ? "Verified numbers appear under Subscribers. You can export them as a CSV or have them copied with their SMS consent to Klaviyo (connect it under Subscribers) and text them from there. This app does not send marketing texts itself, and opt-outs by reply (STOP) are handled by the service that sends your texts: record any you receive elsewhere on the Subscribers page. Each confirmation code counts toward your plan's monthly SMS verifications. Have your consent wording reviewed for the countries you sell to."
              : "Confirmed subscribers appear under Subscribers. You can export them as a CSV or have them copied automatically to Klaviyo or Mailchimp (connect one under Subscribers). This app does not send marketing email itself. Have your consent wording reviewed for the regions you sell to."}</p>
          </Section>
        )}

        {isFeed && cfg.feed && (
          <Section title="Notification feed">
            <p className="text-xs text-ink-3">This is one card in the notification feed shoppers open from the bell. It stays available while it is live, so there is no trigger or per-visit limit. Set an end date under Limits to expire it.</p>
            <Field label="Image URL (optional)" hint="https image shown at the top of the card">
              <Input value={cfg.creative.imageUrl ?? ""} placeholder="https://" onChange={(e) => patch((c) => { const { imageUrl: _i, ...cr } = c.creative; return { ...c, creative: e.target.value ? { ...cr, imageUrl: e.target.value } : cr }; })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" hint="A short label such as Offers or News"><Input maxLength={40} value={cfg.feed.category} onChange={(e) => patch((c) => ({ ...c, feed: { ...c.feed!, category: e.target.value } }))} /></Field>
              <Field label="Order" hint="Lower comes first; ties show newest first"><Input type="number" min={0} max={1000} value={cfg.feed.order} onChange={(e) => { const n = Math.min(1000, Math.max(0, Number(e.target.value))); patch((c) => ({ ...c, feed: { ...c.feed!, order: n } })); }} /></Field>
              <Field label="Audience"><Select value={cfg.feed.audience} onChange={(e) => patch((c) => ({ ...c, feed: { ...c.feed!, audience: e.target.value as "public" | "targeted" } }))}><option value="public">Everyone</option><option value="targeted">Targeted by the rules in Targeting</option></Select></Field>
              <Field label="Bell position" hint="Taken from the first card in the feed"><Select value={cfg.feed.position} onChange={(e) => patch((c) => ({ ...c, feed: { ...c.feed!, position: e.target.value as "bottom_right" | "bottom_left" } }))}><option value="bottom_right">Bottom right</option><option value="bottom_left">Bottom left</option></Select></Field>
            </div>
          </Section>
        )}

        {isToast && cfg.toast && (
          <Section title="Toast">
            <Field label="Type" hint={TOAST_KINDS.find((k) => k.id === cfg.toast?.kind)?.hint ?? ""}>
              <Select value={cfg.toast.kind} onChange={(e) => {
                const kind = e.target.value as NonNullable<Cfg["toast"]>["kind"];
                patch((c) => ({ ...c, toast: { ...c.toast!, kind, ...(kind === "shipping_incentive" ? { freeShippingThreshold: c.toast?.freeShippingThreshold ?? 75 } : {}) } }));
              }}>{TOAST_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>
            </Field>
            {cfg.toast.kind === "shipping_incentive" && (
              <Field label={`Free-shipping threshold (${store.currency})`} hint="Your store's real free-shipping minimum. The remaining amount is calculated from each shopper's cart.">
                <Input type="number" min={1} value={cfg.toast.freeShippingThreshold ?? ""} onChange={(e) => { const n = Number(e.target.value); patch((c) => { const { freeShippingThreshold: _t, ...t } = c.toast!; return { ...c, toast: n > 0 ? { ...t, freeShippingThreshold: n } : t }; }); }} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Corner"><Select value={cfg.toast.corner} onChange={(e) => patch((c) => ({ ...c, toast: { ...c.toast!, corner: e.target.value as NonNullable<Cfg["toast"]>["corner"] } }))}>
                <option value="bottom_left">Bottom left</option><option value="bottom_right">Bottom right</option><option value="top_left">Top left</option><option value="top_right">Top right</option>
              </Select></Field>
              <Field label="Animation"><Select value={cfg.toast.animation} onChange={(e) => patch((c) => ({ ...c, toast: { ...c.toast!, animation: e.target.value as NonNullable<Cfg["toast"]>["animation"] } }))}>
                <option value="slide">Slide</option><option value="fade">Fade</option><option value="none">None</option>
              </Select></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.toast.durationSeconds !== undefined}
              onChange={(e) => patch((c) => { const { durationSeconds: _d, ...t } = c.toast!; return { ...c, toast: e.target.checked ? { ...t, durationSeconds: 10 } : t }; })} />Hide automatically</label>
            {cfg.toast.durationSeconds !== undefined && (
              <Field label="Hide after (seconds)" hint="It stays put while the shopper hovers over it or has focus inside it. Hiding on its own does not count as a dismissal.">
                <Input type="number" min={3} max={120} className="w-28" value={cfg.toast.durationSeconds} onChange={(e) => { const n = Math.min(120, Math.max(3, Number(e.target.value))); patch((c) => ({ ...c, toast: { ...c.toast!, durationSeconds: n } })); }} />
              </Field>
            )}
          </Section>
        )}

        {cfg.format !== "announcement_bar" && cfg.format !== "restock" && !isUpsell && (!isToast || cfg.toast?.kind === "product_offer") && (
          <Section title="Featured products (optional)">
            <p className="text-xs text-ink-3">Show up to 3 products from your catalog as cards. Only the title, link and image are saved; prices and stock are never shown because they go stale.</p>
            {(cfg.creative.products ?? []).map((p, i) => (
              <div key={p.url + i} className="flex items-center justify-between gap-2 border-b border-line py-1.5 text-sm"><span className="truncate">{p.title}</span>
                <button type="button" aria-label={`Remove ${p.title}`} className="text-ink-3 hover:text-danger" onClick={() => patch((c) => { const rest = (c.creative.products ?? []).filter((_, j) => j !== i); const { products: _p, ...cr } = c.creative; return { ...c, creative: rest.length ? { ...cr, products: rest } : cr }; })}><Trash2 className="size-4" /></button></div>
            ))}
            {(cfg.creative.products?.length ?? 0) < 3 && (
              <Select aria-label="Add a product" value="" onChange={(e) => {
                const p = catalog.data?.find((x) => x.id === e.target.value); if (!p) return;
                const url = p.url ?? (p.handle ? `/products/${p.handle}` : null); if (!url) return;
                patch((c) => ({ ...c, creative: { ...c.creative, products: [...(c.creative.products ?? []), { title: p.title.slice(0, 120), url, ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}) }] } }));
              }}>
                <option value="">{catalog.data?.length ? "+ Add a product…" : "Import products in Settings first"}</option>
                {catalog.data?.filter((p) => p.url ?? p.handle).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </Select>
            )}
          </Section>
        )}
        </>)}

        {panel("design", <>
        <Section title="Appearance">
          <div className="grid grid-cols-2 gap-3">
            {([["background", "Background"], ["text", "Text"], ["accent", "Button"], ["accentText", "Button text"]] as const).map(([k, label]) => (
              <Field key={k} label={label}>
                <div className="flex items-center gap-2"><input type="color" aria-label={label} value={cfg.style[k]} onChange={(e) => patch((c) => ({ ...c, style: { ...c.style, [k]: e.target.value.toUpperCase() } }))} className="h-9 w-12 rounded border border-line bg-surface" /><span className="num text-xs text-ink-3">{cfg.style[k]}</span></div>
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!isToast && !isFeed && !isUpsell && <Field label="Placement"><Select value={cfg.style.placement} onChange={(e) => patch((c) => ({ ...c, style: { ...c.style, placement: e.target.value as Cfg["style"]["placement"] } }))}>{["center", "bottom_right", "bottom_left", "top", "bottom"].map((p) => <option key={p}>{p}</option>)}</Select></Field>}
            <Field label="Corner radius"><Input type="number" min={0} max={24} value={cfg.style.radius} onChange={(e) => patch((c) => ({ ...c, style: { ...c.style, radius: Math.min(24, Math.max(0, Number(e.target.value))) } }))} /></Field>
          </div>
        </Section>
        </>)}

        {panel("audience", <>
        <Section title="Who sees it">
          <div className="flex items-center gap-2 text-sm">Show when
            <Select aria-label="Match mode" className="w-24" value={cfg.targeting.match} onChange={(e) => patch((c) => ({ ...c, targeting: { ...c.targeting, match: e.target.value as "all" | "any" } }))}><option value="all">all</option><option value="any">any</option></Select> of these are true:
          </div>
          <div>
            {cfg.targeting.conditions.map((cond, i) => (
              <ConditionRow key={i} c={cond} products={productOptions}
                onChange={(n) => patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: c.targeting.conditions.map((x, j) => (j === i ? n : x)) } }))}
                onRemove={() => patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: c.targeting.conditions.filter((_, j) => j !== i) } }))} />
            ))}
          </div>
          <Select aria-label="Add rule" value="" onChange={(e) => { const f = RULE_FIELDS.find((x) => x.id === e.target.value); if (f) patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: [...c.targeting.conditions, f.make()] } })); }}>
            <option value="">+ Add a rule…</option>{RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
          <p className="rounded-xl border border-brand-tint bg-brand-soft px-4 py-3 text-sm leading-relaxed"><span className="font-medium">In plain English:</span> {summary}.</p>
        </Section>
        </>)}

        {panel("display", <>
        {!isFeed && !passiveUpsell && !passiveForm && <Section title="When it appears">
          <Field label="Trigger"><Select value={cfg.trigger.type} onChange={(e) => {
            const t = e.target.value;
            patch((c) => ({ ...c, trigger: t === "delay" ? { type: "delay", seconds: 5 } : t === "scroll_depth" ? { type: "scroll_depth", percent: 50 } : t === "idle" ? { type: "idle", seconds: 15 } : t === "exit_intent" ? { type: "exit_intent" } : t === "add_to_cart" ? { type: "add_to_cart", delaySeconds: 0 } : t === "cart_threshold" ? { type: "cart_threshold", subtotal: 75 } : { type: "immediate" } }));
          }}><option value="immediate">Immediately</option><option value="delay">After a delay</option><option value="scroll_depth">After scrolling</option><option value="idle">When idle</option><option value="exit_intent">Exit intent (desktop)</option><option value="add_to_cart">When something is added to the cart</option><option value="cart_threshold">When the cart reaches an amount</option></Select></Field>
          {(cfg.trigger.type === "delay" || cfg.trigger.type === "idle") && <Field label="Seconds"><Input type="number" min={cfg.trigger.type === "idle" ? 3 : 0} max={300} value={cfg.trigger.seconds} onChange={(e) => { const s = Number(e.target.value); patch((c) => ({ ...c, trigger: { type: cfg.trigger.type as "delay" | "idle", seconds: s } })); }} /></Field>}
          {cfg.trigger.type === "add_to_cart" && <Field label="Wait (seconds)" hint="Needs the cart reported to the SDK: Shopify is detected automatically; other stores call ConvertFlow.trackAddToCart()."><Input type="number" min={0} max={60} className="w-28" value={cfg.trigger.delaySeconds} onChange={(e) => { const n = Math.min(60, Math.max(0, Number(e.target.value))); patch((c) => ({ ...c, trigger: { type: "add_to_cart", delaySeconds: n } })); }} /></Field>}
          {cfg.trigger.type === "cart_threshold" && <Field label={`Cart subtotal reaches (${store.currency})`}><Input type="number" min={1} className="w-28" value={cfg.trigger.subtotal} onChange={(e) => { const n = Math.max(1, Number(e.target.value)); patch((c) => ({ ...c, trigger: { type: "cart_threshold", subtotal: n } })); }} /></Field>}
          {cfg.trigger.type === "scroll_depth" && <Field label="Scroll depth (%)"><Input type="number" min={5} max={100} value={cfg.trigger.percent} onChange={(e) => { const p = Number(e.target.value); patch((c) => ({ ...c, trigger: { type: "scroll_depth", percent: p } })); }} /></Field>}
        </Section>}

        <Section title="Limits and goal">
          <div className="grid grid-cols-2 gap-3">
            {!isFeed && !passiveUpsell && !passiveForm && <Field label="Max per session"><Input type="number" min={1} max={20} value={cfg.frequency.maxImpressionsPerSession} onChange={(e) => patch((c) => ({ ...c, frequency: { ...c.frequency, maxImpressionsPerSession: Math.max(1, Number(e.target.value)) } }))} /></Field>}
            {!isFeed && !passiveUpsell && !passiveForm && (
              <Field label="Max per visitor (optional)" hint="Across visits. The SDK only remembers this when the shopper consents to analytics.">
                <Input type="number" min={1} max={100} value={cfg.frequency.maxImpressionsPerVisitor ?? ""} onChange={(e) => {
                  const raw = e.target.value, n = Number(raw);
                  patch((c) => { const { maxImpressionsPerVisitor: _v, ...f } = c.frequency; return { ...c, frequency: raw && Number.isFinite(n) && n >= 1 ? { ...f, maxImpressionsPerVisitor: Math.min(100, Math.floor(n)) } : f }; });
                }} />
              </Field>
            )}
            {!isFeed && !passiveUpsell && !passiveForm && <Field label="Hide after dismiss (days)"><Input type="number" min={0} max={365} value={cfg.frequency.suppressAfterDismissDays} onChange={(e) => patch((c) => ({ ...c, frequency: { ...c.frequency, suppressAfterDismissDays: Math.min(365, Math.max(0, Number(e.target.value))) } }))} /></Field>}
            {!isFeed && !passiveUpsell && !passiveForm && <Field label="Hide after click (days)" hint="0 turns this off."><Input type="number" min={0} max={365} value={cfg.frequency.suppressAfterClickDays} onChange={(e) => patch((c) => ({ ...c, frequency: { ...c.frequency, suppressAfterClickDays: Math.min(365, Math.max(0, Number(e.target.value))) } }))} /></Field>}
            <Field label="Priority (0–100)" hint="Higher wins conflicts"><Input type="number" min={0} max={100} value={cfg.priority} onChange={(e) => patch((c) => ({ ...c, priority: Math.min(100, Math.max(0, Number(e.target.value))) }))} /></Field>
            {!isFeed && <Field label="Goal"><Select value={cfg.goal.type} onChange={(e) => patch((c) => ({ ...c, goal: { ...c.goal, type: e.target.value as Cfg["goal"]["type"] } }))}><option value="clicks">Clicks</option><option value="add_to_cart">Add to cart</option><option value="purchase">Purchase</option><option value="subscribe">Subscribe</option></Select></Field>}
            <Field label="Starts" hint="Your local time"><Input type="datetime-local" value={toLocalDateTimeInput(cfg.schedule.startsAt)} onChange={(e) => patch((c) => { const { startsAt: _s, ...rest } = c.schedule; const startsAt = fromLocalDateTimeInput(e.target.value); return { ...c, schedule: startsAt ? { ...rest, startsAt } : rest }; })} /></Field>
            <Field label="Ends" hint="Your local time"><Input type="datetime-local" value={toLocalDateTimeInput(cfg.schedule.endsAt)} onChange={(e) => patch((c) => { const { endsAt: _e, ...rest } = c.schedule; const endsAt = fromLocalDateTimeInput(e.target.value); return { ...c, schedule: endsAt ? { ...rest, endsAt } : rest }; })} /></Field>
          </div>
        </Section>
        </>)}

        {panel("offer", <>
        {!isUpsell && <Section title={isEmail ? "Sign-up incentive (optional)" : "Discount code (optional)"}>
          {guard.data && guard.data.maxDiscountPercent === null && !cfg.promotion && <p className="text-xs text-ink-3">Promotions are off for this store. Set a maximum discount under Settings, Promotions guardrail, to enable them.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cfg.promotion} onChange={(e) => patch((c) => { const { promotion: _x, ...rest } = c; return e.target.checked ? { ...rest, promotion: { code: "SAVE10", percentOff: 10 } } : rest; })} />{isEmail ? "Give subscribers a discount code once they confirm" : "Show a discount code in this campaign"}</label>
          {isSms && cfg.promotion && <p className="text-xs text-ink-3">The code is never shown on the form. It appears in the form only after the shopper confirms their number with the texted code. Everyone who confirms gets the same code, and it is only given while your store limit allows this percentage.</p>}
          {isEmail && cfg.promotion && <p className="text-xs text-ink-3">The code is never shown on the form. It appears on the confirmation page, and in a welcome email, only after the shopper confirms from their inbox. Everyone who confirms gets the same code: it is not single-use or personal, so set that up in your store if you need it to be. It is only given while your store limit allows this percentage.</p>}
          {cfg.promotion && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" hint="Must already exist in your store"><Input value={cfg.promotion.code} maxLength={32} onChange={(e) => patch((c) => ({ ...c, promotion: { ...c.promotion!, code: e.target.value.toUpperCase() } }))} /></Field>
              <Field label="Percent off" hint={guard.data?.maxDiscountPercent ? `Store limit: ${guard.data.maxDiscountPercent}%` : "Store limit not set"}><Input type="number" min={1} max={90} value={cfg.promotion.percentOff} onChange={(e) => patch((c) => ({ ...c, promotion: { ...c.promotion!, percentOff: Math.min(90, Math.max(1, Number(e.target.value))) } }))} /></Field>
            </div>
            <Field label="Label (optional)"><Input maxLength={60} value={cfg.promotion.label ?? ""} onChange={(e) => patch((c) => { const { label: _l, ...p } = c.promotion!; return { ...c, promotion: e.target.value ? { ...p, label: e.target.value } : p }; })} /></Field>
          </>)}
        </Section>}
        </>)}

        {panel("test", <>
        <Section title="Measure real impact (optional)">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cfg.experiment} onChange={(e) => patch((c) => { const { experiment: _x, ...rest } = c; return e.target.checked ? { ...rest, experiment: { holdoutPercent: 10 } } : rest; })} />Hold some visitors out as a control group (Growth)</label>
          {cfg.experiment && (<>
            <Field label="Holdout (% of consenting visitors)" hint="They never see this campaign. Compare their orders with everyone else's to estimate real lift."><Input type="number" min={1} max={50} className="w-28" value={cfg.experiment.holdoutPercent} onChange={(e) => patch((c) => ({ ...c, experiment: { holdoutPercent: Math.min(50, Math.max(1, Number(e.target.value))) } }))} /></Field>
            <p className="text-xs text-ink-3">Visitors who have not consented always see the campaign and are not counted.</p>
          </>)}
        </Section>
        </>)}

        {row && panel("history", <div className="px-5 py-5"><VersionHistory store={store} campaignId={row.id} bare empty={<p className="text-sm text-ink-3">Nothing has been published yet. Each publish creates a version you can roll back to.</p>} /></div>)}
        </div>

        <main className={`${pane === "preview" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-surface-2 lg:flex`} style={{ backgroundImage: "radial-gradient(rgba(10,12,20,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
          <div className="flex items-center justify-between px-5 pt-4">
            <h2 className="font-display text-xs font-bold uppercase tracking-[0.14em]">Live preview</h2>
            <span className="text-xs text-ink-3">{device === "mobile" ? "Mobile, 390 px" : "Desktop"}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <CampaignPreview config={cfg} device={device} domain={store.domain} currency={store.currency} fill />
          </div>
          <div className="max-h-28 space-y-3 lg:max-h-[38%] overflow-y-auto border-t border-line bg-surface/80 px-5 py-4 empty:hidden">
            {!launching && <ErrorNote error={error} />}
            {issues.length > 0 && <ul className="list-disc pl-5 text-sm text-danger">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
            {!check.success && <ul className="list-disc pl-5 text-sm text-danger">{check.error.issues.slice(0, 4).map((i) => <li key={i.path.join(".") + i.message}>{i.path.join(".")}: {i.message}</li>)}</ul>}
            {warnings.map((w) => <p key={w} className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed">{w}</p>)}
          </div>
        </main>
      </div>

      <LaunchDrawer open={launching} onClose={() => setLaunching(false)}>
        <div className="card-flat rounded-2xl border border-line bg-canvas/50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4 text-brand" aria-hidden />{cfg.name}</div>
          <p className="mt-2 text-sm leading-relaxed text-ink-2"><span className="font-medium text-ink">Who sees it:</span> {summary}.</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2"><span className="font-medium text-ink">Where:</span> <span className="num">{store.domain}</span></p>
        </div>
        {issueCount > 0 && <p className="text-sm text-danger">Fix the {issueCount} {issueCount === 1 ? "issue" : "issues"} shown under the preview before launching.</p>}
        {warnings.length > 0 && <p className="text-sm text-ink-2">{warnings.length} {warnings.length === 1 ? "warning" : "warnings"} shown under the preview. Warnings do not block launching.</p>}
        <ErrorNote error={error} />
        <label className="flex items-start gap-2.5 rounded-2xl border border-line bg-ink/[0.02] p-4 text-sm leading-relaxed">
          <input type="checkbox" className="mt-0.5 size-4 accent-[#2350ff]" checked={approved} disabled={!check.success} onChange={(e) => setApproved(e.target.checked)} />
          <span>I&apos;ve reviewed this campaign and approve it to go live on <span className="num">{store.domain}</span>.</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void publish()} busy={busy === "publish"} disabled={!check.success || !approved}>{isLive ? "Publish changes" : "Publish"}</Button>
          <Button onClick={() => setLaunching(false)}>Keep editing</Button>
        </div>
        <p className="text-xs text-ink-3">Each publish creates a new immutable version you can roll back to. Nothing goes live until you publish.</p>
      </LaunchDrawer>
    </div></BuilderHost>
  );
}
