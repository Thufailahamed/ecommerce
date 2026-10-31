"use client";
import { Check, Copy, CreditCard, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { builder, storeUrl } from "@/lib/builder";
import { useBuilder } from "./state";
import { Btn, Label, NumberField, PanelSection, Switch, TextField, inputClass } from "./controls";
import { ImageField, LinkField } from "./fields";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY", "CHF", "SEK", "NOK", "DKK", "INR", "SGD", "HKD", "AED", "ZAR", "BRL", "MXN"];
const SOCIAL = ["instagram", "tiktok", "facebook", "x", "youtube", "pinterest"] as const;

export function SettingsPanel() {
  const { site, doc, apply, canEdit, canPublish, updateSite, toast } = useBuilder();
  const router = useRouter();
  const s = doc.settings;
  const setSettings = (settings: Record<string, unknown>, key: string) => apply([{ op: "set_settings", settings }], `settings:${key}`);
  const setBrand = (brand: Record<string, unknown>, key: string) => apply([{ op: "set_brand", brand }], `brand:${key}`);

  const [slug, setSlug] = useState(site.slug);
  const [notify, setNotify] = useState(site.notifyEmail ?? "");
  const [stripeKey, setStripeKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setSlug(site.slug), [site.slug]);

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}${storeUrl(site.slug)}` : storeUrl(site.slug);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast(e instanceof ApiError ? e.message : "Something went wrong", "error"); } finally { setBusy(null); }
  };

  return (
    <div className="sidebar-scroll min-h-0 flex-1 overflow-y-auto">
      <fieldset disabled={!canEdit}>
        <PanelSection title="Brand">
          <TextField label="Store name" value={doc.brand.name} max={60} onChange={(v) => setBrand({ name: v }, "name")} />
          <TextField label="Tagline" value={doc.brand.tagline} max={140} onChange={(v) => setBrand({ tagline: v }, "tagline")} />
          <ImageField label="Logo (optional; the name is used without one)" value={doc.brand.logo} optional onChange={(v) => setBrand({ logo: v }, "logo")} />
        </PanelSection>

        <PanelSection title="Contact">
          <TextField label="Contact email (shown to customers)" type="email" value={s.contactEmail ?? ""} max={254} onChange={(v) => setSettings({ contactEmail: v || null }, "email")} />
        </PanelSection>

        <PanelSection title="Checkout" description="Shipping is added to every order. Leave both at zero for free shipping.">
          <div>
            <Label htmlFor="currency">Currency</Label>
            <select id="currency" value={s.currency} onChange={(e) => setSettings({ currency: e.target.value }, "currency")} className={`${inputClass} h-9`}>
              {(CURRENCIES.includes(s.currency) ? CURRENCIES : [s.currency, ...CURRENCIES]).map((c) => <option key={c} value={c} className="bg-surface">{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Flat shipping" prefix={s.currency} min={0} step={0.5} value={s.shipping.flatRate} onChange={(v) => setSettings({ shipping: { ...s.shipping, flatRate: v ?? 0 } }, "flat")} />
            <NumberField label="Free over" prefix={s.currency} min={0} step={1} value={s.shipping.freeOver} onChange={(v) => setSettings({ shipping: { ...s.shipping, freeOver: v } }, "free")} />
          </div>
        </PanelSection>

        <PanelSection title="Announcement bar">
          <Switch label="Show announcement" checked={s.announcement.enabled} onChange={(v) => setSettings({ announcement: { ...s.announcement, enabled: v } }, "ann-on")} />
          {s.announcement.enabled && (
            <>
              <TextField label="Text" value={s.announcement.text} max={140} onChange={(v) => setSettings({ announcement: { ...s.announcement, text: v } }, "ann-text")} />
              <LinkField label="Link" optional value={s.announcement.href ? { label: "Link", href: s.announcement.href } : undefined}
                onChange={(l) => setSettings({ announcement: { enabled: s.announcement.enabled, text: s.announcement.text, ...(l ? { href: l.href } : {}) } }, "ann-href")} />
            </>
          )}
        </PanelSection>

        <PanelSection title="Search and sharing">
          {/* null clears a field: set_settings deep-merges, so an absent value would keep the old one. */}
          <TextField label="Title" value={s.seo.title ?? ""} max={70} placeholder={doc.brand.name} onChange={(v) => setSettings({ seo: { title: v || null } }, "seo-t")} />
          <TextField label="Description" value={s.seo.description ?? ""} max={170} onChange={(v) => setSettings({ seo: { description: v || null } }, "seo-d")} />
        </PanelSection>

        <PanelSection title="Social links">
          {SOCIAL.map((k) => (
            <TextField key={k} label={k === "x" ? "X (Twitter)" : k[0]!.toUpperCase() + k.slice(1)} value={s.social[k] ?? ""} placeholder="https://"
              onChange={(v) => setSettings({ social: { [k]: /^https?:\/\/\S+$/.test(v) ? v : null } }, `social-${k}`)} />
          ))}
        </PanelSection>
      </fieldset>

      <PanelSection title="Store address">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ink/[0.02] px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{publicUrl}</span>
          <button type="button" aria-label="Copy address" onClick={() => { void navigator.clipboard.writeText(publicUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="text-ink-3 hover:text-ink">
            {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
          </button>
          {site.status === "published" && <a href={storeUrl(site.slug)} target="_blank" rel="noreferrer" aria-label="Open store" className="text-ink-3 hover:text-ink"><ExternalLink className="size-3.5" /></a>}
        </div>
        {canPublish && (
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("slug", async () => { const r = await builder.update(site.id, { slug }); updateSite({ slug: r.slug }); toast("Address updated", "ok"); }); }}>
            <div className="flex-1"><TextField label="Address" value={slug} onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} max={48} /></div>
            <Btn type="submit" size="sm" busy={busy === "slug"} disabled={slug === site.slug || slug.length < 3}>Save</Btn>
          </form>
        )}
      </PanelSection>

      {canPublish && (
        <PanelSection title="Notifications">
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run("notify", async () => { await builder.update(site.id, { notifyEmail: notify || null }); updateSite({ notifyEmail: notify || null }); toast("Saved", "ok"); }); }}>
            <div className="flex-1"><TextField label="Email me orders and messages at" type="email" value={notify} onChange={setNotify} placeholder={s.contactEmail ?? "you@example.com"} /></div>
            <Btn type="submit" size="sm" busy={busy === "notify"} disabled={notify === (site.notifyEmail ?? "")}>Save</Btn>
          </form>
        </PanelSection>
      )}

      {canPublish && (
        <PanelSection title="Payments" description="Connect your own Stripe account to take card payments. Without it, orders are recorded and you arrange payment with the customer.">
          {site.paymentsConnected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink"><CreditCard className="size-4 text-ok" aria-hidden />Stripe connected</span>
              <Btn size="sm" variant="ghost" busy={busy === "pay"} onClick={() => void run("pay", async () => { await builder.payments(site.id, null); updateSite({ paymentsConnected: false }); toast("Stripe disconnected", "ok"); })}>Disconnect</Btn>
            </div>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run("pay", async () => { await builder.payments(site.id, stripeKey.trim()); setStripeKey(""); updateSite({ paymentsConnected: true }); toast("Stripe connected. Republish to take card payments.", "ok"); }); }}>
              <TextField label="Stripe secret key" type="password" value={stripeKey} onChange={setStripeKey} placeholder="sk_live_… or a restricted key" />
              <p className="text-[11px] leading-relaxed text-ink-3">Checked with Stripe, stored encrypted and never shown again. Use a restricted key with Checkout Sessions write access where you can.</p>
              <Btn type="submit" size="sm" variant="primary" busy={busy === "pay"} disabled={stripeKey.trim().length < 12}>Connect Stripe</Btn>
            </form>
          )}
        </PanelSection>
      )}

      {canPublish && (
        <PanelSection title="Danger zone">
          <p className="text-[12px] text-ink-3">This store is {site.status === "published" ? "live" : "a draft"}.</p>
          <div className="flex flex-wrap gap-2">
            {site.status === "published" && <Btn size="sm" busy={busy === "unpub"} onClick={() => void run("unpub", async () => { await builder.unpublish(site.id); updateSite({ status: "draft", publishedAt: site.publishedAt }); toast("The store is offline", "ok"); })}>Unpublish</Btn>}
            <Btn size="sm" variant="danger" busy={busy === "archive"} onClick={() => {
              if (!window.confirm(`Archive ${site.name}? It goes offline immediately and its payment key is removed.`)) return;
              void run("archive", async () => { await builder.archive(site.id); router.replace("/app/sites"); });
            }}>Archive store</Btn>
          </div>
        </PanelSection>
      )}
    </div>
  );
}
