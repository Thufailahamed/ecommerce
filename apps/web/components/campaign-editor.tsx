"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { CampaignConfig, type Condition } from "@convertflow/contracts";
import { describeRuleGroup } from "@convertflow/campaign-engine";
import { api, ApiError, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { Badge, Button, ErrorNote, Field, Input, Select, Textarea, statusTone } from "./ui";
import { CampaignPreview, type Device } from "./campaign-preview";

type Cfg = CampaignConfig;

export type EditorTool = "toast" | "feed" | "email" | "upsell";

type RecOptions = NonNullable<Cfg["recommend"]>;

export const defaultConfig = (tool?: EditorTool): Cfg => {
  const base: Cfg = {
    schemaVersion: 1, name: "New campaign", format: "popup",
    creative: { headline: "Welcome in", body: "Take a look at what's new.", ctaLabel: "Shop now", ctaUrl: "/collections/all" },
    style: { background: "#FFFFFF", text: "#191A1B", accent: "#003FFF", accentText: "#FFFFFF", radius: 8, placement: "center" },
    trigger: { type: "delay", seconds: 5 },
    targeting: { match: "all", conditions: [] },
    schedule: {}, frequency: { maxImpressionsPerSession: 1, suppressAfterDismissDays: 7, suppressAfterClickDays: 30 },
    priority: 50, goal: { type: "clicks" },
  };
  if (tool === "feed") {
    return { ...base, name: "New notification", tool: "feed", format: "feed_item", feed: { category: "Updates", order: 100, audience: "public", position: "bottom_right" },
      creative: { ...base.creative, headline: "A new collection just dropped", body: "Take a look at what's new this week." }, trigger: { type: "immediate" } };
  }
  if (tool === "email") {
    return { ...base, name: "New email signup", tool: "email", format: "popup", goal: { type: "subscribe" },
      creative: { ...base.creative, headline: "Join our email list", body: "News and offers, straight to your inbox.", ctaLabel: "Sign up", ctaUrl: "/" },
      form: {
        collect: { email: true, phone: false, firstName: false }, defaultCountry: "US",
        consentText: "I agree to receive marketing emails from this store. I can unsubscribe at any time.",
        consentCheckbox: true, privacyUrl: "/policies/privacy-policy", doubleOptIn: true,
        successMessage: "Thanks. You're signed up.", pendingMessage: "Check your inbox to confirm your subscription.",
      } };
  }
  if (tool === "upsell") {
    return { ...base, name: "New recommendations", tool: "upsell", format: "recommendation", goal: { type: "add_to_cart" }, trigger: { type: "immediate" },
      creative: { ...base.creative, headline: "You might also like", body: "", ctaLabel: "Add to cart", ctaUrl: "/" },
      targeting: { match: "all", conditions: [{ field: "page_type", op: "in", value: ["product"] }] },
      recommend: { source: "same_collection", productIds: [], collectionIds: [], excludeProductIds: [], maxProducts: 3, layout: "row", placement: "product_page", showPrice: true, onlyAvailable: true, addToCart: true } };
  }
  return tool === "toast"
    ? { ...base, name: "New toast", tool: "toast", format: "toast", toast: { kind: "announcement", corner: "bottom_left", animation: "slide" }, creative: { ...base.creative, headline: "Something new just landed", body: "" } }
    : base;
};

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

const RULE_FIELDS: { id: string; label: string; make: () => Condition }[] = [
  { id: "page_type", label: "Page type", make: () => ({ field: "page_type", op: "in", value: ["product"] }) },
  { id: "device", label: "Device", make: () => ({ field: "device", op: "in", value: ["mobile"] }) },
  { id: "cart_subtotal", label: "Cart subtotal", make: () => ({ field: "cart_subtotal", op: "gte", value: 50 }) },
  { id: "visitor_type", label: "Visitor type", make: () => ({ field: "visitor_type", op: "equals", value: "new" }) },
  { id: "url_path", label: "URL path", make: () => ({ field: "url_path", op: "starts_with", value: "/collections/" }) },
  { id: "pages_viewed", label: "Pages viewed", make: () => ({ field: "pages_viewed", op: "gte", value: 3 }) },
];

function ConditionRow({ c, onChange, onRemove }: { c: Condition; onChange(c: Condition): void; onRemove(): void }) {
  const pageTypes = ["home", "collection", "product", "cart", "checkout", "search", "content"] as const;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm">
      <span className="w-28 font-medium">{RULE_FIELDS.find((f) => f.id === c.field)?.label ?? c.field}</span>
      {c.field === "page_type" && (<>
        <Select aria-label="Operator" className="w-24" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "in" | "not_in" })}><option value="in">is</option><option value="not_in">is not</option></Select>
        <Select aria-label="Page type" className="w-36" value={c.value[0]} onChange={(e) => onChange({ ...c, value: [e.target.value as (typeof pageTypes)[number]] })}>{pageTypes.map((p) => <option key={p}>{p}</option>)}</Select>
      </>)}
      {c.field === "device" && (
        <Select aria-label="Device" className="w-36" value={c.value[0]} onChange={(e) => onChange({ ...c, value: [e.target.value as "mobile" | "tablet" | "desktop"] })}><option>mobile</option><option>tablet</option><option>desktop</option></Select>
      )}
      {c.field === "cart_subtotal" && (<>
        <Select aria-label="Operator" className="w-28" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "gte" | "lte" })}><option value="gte">at least</option><option value="lte">at most</option></Select>
        <Input aria-label="Amount" type="number" min={0} className="w-28" value={c.value} onChange={(e) => onChange({ ...c, value: Math.max(0, Number(e.target.value)) })} />
      </>)}
      {c.field === "visitor_type" && (
        <Select aria-label="Visitor" className="w-36" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value as "new" | "returning" })}><option>new</option><option>returning</option></Select>
      )}
      {c.field === "url_path" && (<>
        <Select aria-label="Operator" className="w-32" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "equals" | "starts_with" | "contains" })}><option value="equals">equals</option><option value="starts_with">starts with</option><option value="contains">contains</option></Select>
        <Input aria-label="Path" className="w-48" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
      </>)}
      {c.field === "pages_viewed" && (<><span className="text-ink-2">at least</span><Input aria-label="Pages" type="number" min={1} className="w-20" value={c.value} onChange={(e) => onChange({ ...c, value: Math.max(1, Number(e.target.value)) })} /></>)}
      <button type="button" aria-label="Remove rule" className="ml-auto text-ink-3 hover:text-danger" onClick={onRemove}><Trash2 className="size-4" /></button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card mb-5 space-y-4 p-5 md:p-6"><h2 className="font-display text-xs font-bold uppercase tracking-[0.14em]">{title}</h2><div className="space-y-4">{children}</div></section>;
}

export function CampaignEditor({ store, campaign, initial, tool }: { store: Store; campaign?: CampaignRow; initial?: unknown; tool?: EditorTool }) {
  const router = useRouter();
  const parsedInitial = CampaignConfig.safeParse(initial ?? campaign?.draftConfig);
  const [cfg, setCfg] = useState<Cfg>(parsedInitial.success ? parsedInitial.data : defaultConfig(tool));
  const isToast = cfg.tool === "toast";
  const isFeed = cfg.tool === "feed";
  const isEmail = cfg.tool === "email" && cfg.format !== "restock"; // legacy back-in-stock forms keep the classic editor
  const isUpsell = cfg.tool === "upsell";
  // What the merchant is typing, kept apart from the saved value: parsing on every keystroke would swallow a trailing comma or an emptied number.
  const [collectionsText, setCollectionsText] = useState(() => cfg.recommend?.collectionIds.join(", ") ?? "");
  const [countText, setCountText] = useState(() => String(cfg.recommend?.maxProducts ?? 3));
  /** An inline recommendation block is part of the page, like the feed: no trigger, per-visit caps or dismissal. */
  const passiveUpsell = isUpsell && cfg.recommend?.placement !== "toast";
  /** An inline signup form sits in the page like the feed and inline recommendations: no trigger, per-visit caps or dismissal. */
  const passiveForm = isEmail && cfg.format === "inline";
  const [row, setRow] = useState(campaign);
  const [device, setDevice] = useState<Device>("desktop");
  const [busy, setBusy] = useState<null | "save" | "publish">(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [approved, setApproved] = useState(false);
  const [dirty, setDirty] = useState(!campaign);

  const base = `/api/v1/stores/${store.id}/campaigns`;
  const catalog = useApi<{ id: string; externalId: string; title: string; url: string | null; handle: string | null; imageUrl: string | null }[]>(`/api/v1/stores/${store.id}/products`);
  const guard = useApi<{ maxDiscountPercent: number | null }>(`/api/v1/stores/${store.id}/integration`);
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
    if (isUpsell && cfg.recommend) {
      if (catalog.data && catalog.data.length === 0) w.push("Your catalog is empty. Recommendations only use products from your catalog, with their real prices and stock, so nothing will show until you import or sync it.");
      if (cfg.recommend.placement === "cart" && !cfg.targeting.conditions.some((x) => x.field === "page_type" || x.field === "cart_item_count" || x.field === "cart_subtotal")) w.push("A cart block should target the cart page or a cart rule, otherwise it may appear where there is no cart.");
      if (cfg.recommend.addToCart && store.platform === "custom") w.push("On a custom store, products can only be added without leaving the page if your site provides ConvertFlow.addToCart. Without it they link to the product page.");
      if (cfg.recommend.source === "alternatives") w.push("Alternatives only show on a product your catalog says is out of stock, so keep your stock levels synced.");
    }
    return w;
  }, [cfg, isToast, isEmail, isUpsell, catalog.data, store.platform]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError) { setError(e.message); setIssues(Array.isArray(e.details) ? e.details.map((d) => typeof d === "string" ? d : JSON.stringify(d)) : []); }
    else setError("Something went wrong. Try again.");
  };

  /**
   * `navigate` moves to the saved campaign's page (a remount). When publishing we do NOT navigate until it
   * succeeds: remounting would throw away the error message if the server rejects the publish. The URL is
   * updated in place instead, so a refresh still lands on the saved draft.
   */
  async function save(navigate = true): Promise<CampaignRow | null> {
    setBusy("save"); setError(null); setIssues([]);
    try {
      const r = row ? await api<CampaignRow>(`${base}/${row.id}`, { method: "PUT", body: cfg }) : await api<CampaignRow>(base, { method: "POST", body: cfg });
      setRow(r); setDirty(false);
      if (!row) { if (navigate) router.replace(`/app/campaigns/${r.id}`); else window.history.replaceState(null, "", `/app/campaigns/${r.id}`); }
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
      setRow(fresh); setApproved(false);
      if (wasNew) router.replace(`/app/campaigns/${saved.id}`); // now it is live: show the full page with version history
    } catch (e) { fail(e); } finally { setBusy(null); }
  }

  const isLive = row?.status === "active" || row?.status === "scheduled";

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div>
        <div className="mb-5 flex items-center gap-2">
          <Input aria-label="Campaign name" value={cfg.name} onChange={(e) => patch((c) => ({ ...c, name: e.target.value }))} className="font-medium" />
          {row && <Badge tone={statusTone(row.status)}>{row.status}</Badge>}
        </div>

        <Section title="Format and message">
          {!isToast && !isFeed && !isEmail && !isUpsell && <Field label="Format"><Select value={cfg.format} onChange={(e) => {
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
            {!isEmail && !isUpsell && <Field label="Button link" hint="Path or https URL"><Input value={cfg.creative.ctaUrl} onChange={(e) => patch((c) => ({ ...c, creative: { ...c.creative, ctaUrl: e.target.value } }))} /></Field>}
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

        {isEmail && cfg.form && (
          <Section title="Email signup">
            <Field label="Style" hint={cfg.format === "inline" ? "Appears in the page where you put an element with the attribute data-convertflow-form, or at the end of the main content if there is none. It is not triggered: it is simply part of the page." : cfg.format === "announcement_bar" ? "A slim bar along the top or bottom edge." : undefined}>
              <Select value={cfg.format} onChange={(e) => patch((c) => ({ ...c, format: e.target.value as Cfg["format"] }))}><option value="popup">Popup</option><option value="slide_in">Slide-in</option><option value="announcement_bar">Announcement bar</option><option value="inline">Inline (in the page)</option></Select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cfg.form.collect.firstName} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, collect: { ...c.form!.collect, firstName: e.target.checked } } }))} />Also ask for a first name (optional for the shopper)</label>
            <Field label="Consent text" hint="Shown next to an unticked checkbox. The exact words are saved with every signup as proof of consent, so say what they will receive and that they can unsubscribe.">
              <Textarea rows={3} maxLength={600} value={cfg.form.consentText} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, consentText: e.target.value } }))} />
            </Field>
            <Field label="Privacy policy link" hint="Path or https URL"><Input value={cfg.form.privacyUrl} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, privacyUrl: e.target.value } }))} /></Field>
            <Field label="Message after signing up" hint="Shoppers always confirm from their inbox first (double opt-in)."><Input maxLength={160} value={cfg.form.pendingMessage} onChange={(e) => patch((c) => ({ ...c, form: { ...c.form!, pendingMessage: e.target.value } }))} /></Field>
            <p className="rounded-xl border border-brand-tint bg-brand-soft px-4 py-3 text-xs leading-relaxed">Confirmed subscribers appear under Subscribers. You can export them as a CSV or have them copied automatically to Klaviyo or Mailchimp (connect one under Subscribers). This app does not send marketing email itself. Have your consent wording reviewed for the regions you sell to.</p>
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
              <Field label="Audience"><Select value={cfg.feed.audience} onChange={(e) => patch((c) => ({ ...c, feed: { ...c.feed!, audience: e.target.value as "public" | "targeted" } }))}><option value="public">Everyone</option><option value="targeted">Targeted by the rules below</option></Select></Field>
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

        <Section title="Who sees it">
          <div className="flex items-center gap-2 text-sm">Show when
            <Select aria-label="Match mode" className="w-24" value={cfg.targeting.match} onChange={(e) => patch((c) => ({ ...c, targeting: { ...c.targeting, match: e.target.value as "all" | "any" } }))}><option value="all">all</option><option value="any">any</option></Select> of these are true:
          </div>
          <div>
            {cfg.targeting.conditions.map((cond, i) => (
              <ConditionRow key={i} c={cond}
                onChange={(n) => patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: c.targeting.conditions.map((x, j) => (j === i ? n : x)) } }))}
                onRemove={() => patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: c.targeting.conditions.filter((_, j) => j !== i) } }))} />
            ))}
          </div>
          <Select aria-label="Add rule" value="" onChange={(e) => { const f = RULE_FIELDS.find((x) => x.id === e.target.value); if (f) patch((c) => ({ ...c, targeting: { ...c.targeting, conditions: [...c.targeting.conditions, f.make()] } })); }}>
            <option value="">+ Add a rule…</option>{RULE_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
          <p className="rounded-xl border border-brand-tint bg-brand-soft px-4 py-3 text-sm leading-relaxed"><span className="font-medium">In plain English:</span> {summary}.</p>
        </Section>

        <Section title="Limits and goal">
          <div className="grid grid-cols-2 gap-3">
            {!isFeed && !passiveUpsell && !passiveForm && <Field label="Max per session"><Input type="number" min={1} max={20} value={cfg.frequency.maxImpressionsPerSession} onChange={(e) => patch((c) => ({ ...c, frequency: { ...c.frequency, maxImpressionsPerSession: Math.max(1, Number(e.target.value)) } }))} /></Field>}
            {!isFeed && !passiveUpsell && !passiveForm && <Field label="Hide after dismiss (days)"><Input type="number" min={0} value={cfg.frequency.suppressAfterDismissDays} onChange={(e) => patch((c) => ({ ...c, frequency: { ...c.frequency, suppressAfterDismissDays: Math.max(0, Number(e.target.value)) } }))} /></Field>}
            <Field label="Priority (0–100)" hint="Higher wins conflicts"><Input type="number" min={0} max={100} value={cfg.priority} onChange={(e) => patch((c) => ({ ...c, priority: Math.min(100, Math.max(0, Number(e.target.value))) }))} /></Field>
            {!isFeed && <Field label="Goal"><Select value={cfg.goal.type} onChange={(e) => patch((c) => ({ ...c, goal: { ...c.goal, type: e.target.value as Cfg["goal"]["type"] } }))}><option value="clicks">Clicks</option><option value="add_to_cart">Add to cart</option><option value="purchase">Purchase</option><option value="subscribe">Subscribe</option></Select></Field>}
            <Field label="Starts"><Input type="datetime-local" value={cfg.schedule.startsAt?.slice(0, 16) ?? ""} onChange={(e) => patch((c) => { const { startsAt: _s, ...rest } = c.schedule; return { ...c, schedule: e.target.value ? { ...rest, startsAt: new Date(e.target.value).toISOString() } : rest }; })} /></Field>
            <Field label="Ends"><Input type="datetime-local" value={cfg.schedule.endsAt?.slice(0, 16) ?? ""} onChange={(e) => patch((c) => { const { endsAt: _e, ...rest } = c.schedule; return { ...c, schedule: e.target.value ? { ...rest, endsAt: new Date(e.target.value).toISOString() } : rest }; })} /></Field>
          </div>
        </Section>
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

        {!isUpsell && <Section title={isEmail ? "Sign-up incentive (optional)" : "Discount code (optional)"}>
          {guard.data && guard.data.maxDiscountPercent === null && !cfg.promotion && <p className="text-xs text-ink-3">Promotions are off for this store. Set a maximum discount under Settings, Promotions guardrail, to enable them.</p>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cfg.promotion} onChange={(e) => patch((c) => { const { promotion: _x, ...rest } = c; return e.target.checked ? { ...rest, promotion: { code: "SAVE10", percentOff: 10 } } : rest; })} />{isEmail ? "Give subscribers a discount code once they confirm" : "Show a discount code in this campaign"}</label>
          {isEmail && cfg.promotion && <p className="text-xs text-ink-3">The code is never shown on the form. It appears on the confirmation page, and in a welcome email, only after the shopper confirms from their inbox. Everyone who confirms gets the same code: it is not single-use or personal, so set that up in your store if you need it to be. It is only given while your store limit allows this percentage.</p>}
          {cfg.promotion && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" hint="Must already exist in your store"><Input value={cfg.promotion.code} maxLength={32} onChange={(e) => patch((c) => ({ ...c, promotion: { ...c.promotion!, code: e.target.value.toUpperCase() } }))} /></Field>
              <Field label="Percent off" hint={guard.data?.maxDiscountPercent ? `Store limit: ${guard.data.maxDiscountPercent}%` : "Store limit not set"}><Input type="number" min={1} max={90} value={cfg.promotion.percentOff} onChange={(e) => patch((c) => ({ ...c, promotion: { ...c.promotion!, percentOff: Math.min(90, Math.max(1, Number(e.target.value))) } }))} /></Field>
            </div>
            <Field label="Label (optional)"><Input maxLength={60} value={cfg.promotion.label ?? ""} onChange={(e) => patch((c) => { const { label: _l, ...p } = c.promotion!; return { ...c, promotion: e.target.value ? { ...p, label: e.target.value } : p }; })} /></Field>
          </>)}
        </Section>}

        <Section title="Measure real impact (optional)">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!cfg.experiment} onChange={(e) => patch((c) => { const { experiment: _x, ...rest } = c; return e.target.checked ? { ...rest, experiment: { holdoutPercent: 10 } } : rest; })} />Hold some visitors out as a control group (Growth)</label>
          {cfg.experiment && (<>
            <Field label="Holdout (% of consenting visitors)" hint="They never see this campaign. Compare their orders with everyone else's to estimate real lift."><Input type="number" min={1} max={50} className="w-28" value={cfg.experiment.holdoutPercent} onChange={(e) => patch((c) => ({ ...c, experiment: { holdoutPercent: Math.min(50, Math.max(1, Number(e.target.value))) } }))} /></Field>
            <p className="text-xs text-ink-3">Visitors who have not consented always see the campaign and are not counted.</p>
          </>)}
        </Section>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-xs font-bold uppercase tracking-[0.14em]">Live preview</h2>
          <div className="flex gap-1" role="group" aria-label="Device">
            <Button variant={device === "desktop" ? "secondary" : "ghost"} aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor className="size-4" />Desktop</Button>
            <Button variant={device === "mobile" ? "secondary" : "ghost"} aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone className="size-4" />Mobile</Button>
          </div>
        </div>
        <CampaignPreview config={cfg} device={device} domain={store.domain} currency={store.currency} />

        <div className="mt-6 space-y-3">
          <ErrorNote error={error} />
          {issues.length > 0 && <ul className="list-disc pl-5 text-sm text-danger">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
          {!check.success && <ul className="list-disc pl-5 text-sm text-danger">{check.error.issues.slice(0, 4).map((i) => <li key={i.path.join(".") + i.message}>{i.path.join(".")}: {i.message}</li>)}</ul>}
          {warnings.map((w) => <p key={w} className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm leading-relaxed">{w}</p>)}

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={approved} disabled={!check.success} onChange={(e) => setApproved(e.target.checked)} />
            <span>I&apos;ve reviewed this campaign and approve it to go live on <span className="num">{store.domain}</span>.</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} busy={busy === "save"} disabled={!check.success || !dirty}>{row ? "Save draft" : "Create draft"}</Button>
            <Button variant="primary" onClick={() => void publish()} busy={busy === "publish"} disabled={!check.success || !approved}>{isLive ? "Publish changes" : "Publish"}</Button>
            {row && !dirty && <span className="self-center text-xs text-ink-3">Saved</span>}
          </div>
          <p className="text-xs text-ink-3"><Plus className="mr-1 inline size-3" />Each publish creates a new immutable version you can roll back to.</p>
        </div>
      </div>
    </div>
  );
}
