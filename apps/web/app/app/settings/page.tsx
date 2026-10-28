"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { productsFromCsv } from "@convertflow/integrations";
import { api, ApiError, API_URL, type Store } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { Badge, Button, ErrorNote, Input, Notice, PageHeader, Textarea } from "@/components/ui";
import { Section } from "@/components/settings/section";
import { TeamSection } from "@/components/settings/team";
import { SecuritySection } from "@/components/settings/security";
import { BillingSection } from "@/components/settings/billing";
import { CatalogConnect } from "@/components/settings/catalog";
import { DiscountGuardrail } from "@/components/settings/guardrail";
import { WorkspacesSection } from "@/components/settings/workspaces";
import { Code, Package, Power, Receipt, Trash2, Unplug } from "lucide-react";

const SDK_URL = process.env.NEXT_PUBLIC_SDK_URL ?? "http://localhost:8788";

interface Integration { siteKey: string; configPublished: boolean; hasCatalog: boolean; snippet: string; platform: string; connection: { connected: boolean; kind: string | null }; maxDiscountPercent: number | null }

const SAMPLE = JSON.stringify([{ externalId: "sku-1", title: "Trail Runner", url: "/products/trail-runner", variants: [{ externalId: "sku-1-9", price: 99, available: true }] }], null, 2);

function Settings({ store }: { store: Store }) {
  const { me, reload } = useSession();
  const base = `/api/v1/stores/${store.id}`;
  const integ = useApi<Integration>(`${base}/integration`);
  const [copied, setCopied] = useState(false);
  const [json, setJson] = useState(SAMPLE);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delPw, setDelPw] = useState("");

  const myRole = me.organizations.find((o) => o.id === store.organizationId)?.role ?? "viewer";
  const isAdmin = myRole === "owner" || myRole === "admin";
  const snippet = integ.data?.snippet.replace("{SDK_URL}", SDK_URL).replace("{API_URL}", API_URL) ?? "";
  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setError(null); setMsg(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); } };

  return (
    <>
      <PageHeader eyebrow="Configuration" title="Settings" sub={`${store.name} · ${store.domain}`} />
      <ErrorNote error={error ?? integ.error} />
      {msg && <div role="status" className="mb-6"><Notice tone="ok">{msg}</Notice></div>}

      <div className="space-y-6">
      <Section icon={Code} title="Install on your storefront" sub="Paste this before </body> on any platform (Shopify theme, WooCommerce, BigCommerce, Magento or custom). Campaigns respect visitor consent: set window.ConvertFlow = { consent: true } after your cookie banner records analytics consent.">
        <pre className="num overflow-x-auto rounded-xl border border-line bg-canvas/70 p-4 text-xs leading-relaxed text-ink-2">{snippet || "Loading…"}</pre>
        <div className="flex items-center gap-3">
          <Button onClick={async () => { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!snippet}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "Copied" : "Copy snippet"}</Button>
          <Badge tone={integ.data?.configPublished ? "ok" : "warn"}>{integ.data?.configPublished ? "Config published" : "Config not published"}</Badge>
        </div>
        <p className="text-xs text-ink-3">For exact page data (product id, cart subtotal), define <code className="num">window.ConvertFlowContext</code>. Anything not provided is treated as unknown, never guessed. Back-in-stock forms need the product id.</p>
      </Section>

      <CatalogConnect store={store} connection={integ.data?.connection} onChanged={integ.reload} />

      <Section icon={Package} title="Product catalog" sub="Import products from any platform as JSON or CSV (up to 100 per import). Omit “available” if you do not know stock: it is stored as unknown and AI will not claim stock. Importing a product that returns to stock sends back-in-stock alerts to confirmed subscribers.">
        <div>
          <label className="mb-1 block text-[13px] font-medium text-ink-2" htmlFor="csv">Or upload a CSV <span className="font-normal text-ink-3">(columns: id, title, url, image, price, available, collections)</span></label>
          <input id="csv" type="file" accept=".csv,text/csv" className="text-sm" onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            const r = productsFromCsv(await f.text());
            if (r.products.length === 0) { setError(r.errors[0] ?? "No products found in that file."); return; }
            setError(r.errors.length ? `${r.errors.length} row(s) skipped: ${r.errors.slice(0, 3).join("; ")}` : null);
            setJson(JSON.stringify(r.products.slice(0, 100), null, 2));
            setMsg(`Loaded ${Math.min(100, r.products.length)} of ${r.products.length} products. Review below, then import (max 100 per import).`);
          }} />
        </div>
        <Textarea rows={8} className="num text-xs" aria-label="Products JSON" value={json} onChange={(e) => setJson(e.target.value)} />
        <Button busy={busy === "import"} onClick={() => run("import", async () => {
          let products: unknown;
          try { products = JSON.parse(json); } catch { throw new Error("That isn't valid JSON."); }
          const r = await api<{ created: number; updated: number; restocked: number; alertsSent: number }>(`${base}/products/import`, { method: "POST", body: { products } });
          setMsg(`Imported: ${r.created} new, ${r.updated} updated${r.restocked ? `, ${r.restocked} back in stock (${r.alertsSent} alert${r.alertsSent === 1 ? "" : "s"} sent)` : ""}.`); await integ.reload();
        })}>Import products</Button>
      </Section>

      <Section icon={Power} title="Delivery" sub="Pause every campaign on this store instantly without changing any campaign.">
        <Button busy={busy === "delivery"} disabled={!isAdmin} onClick={() => run("delivery", async () => { await api(`${base}/delivery`, { method: "PATCH", body: { enabled: !store.deliveryEnabled } }); await reload(); })}>
          {store.deliveryEnabled ? "Pause all delivery" : "Resume delivery"}
        </Button>
      </Section>

      <DiscountGuardrail store={store} current={integ.data?.maxDiscountPercent} canEdit={isAdmin} onChanged={integ.reload} />
      <TeamSection orgId={store.organizationId} myRole={myRole} myUserId={me.userId} />
      <SecuritySection />
      <WorkspacesSection />
      <BillingSection store={store} isOwner={myRole === "owner"} />

      <Section icon={Receipt} title="Track purchases (non-Shopify stores)" sub="On your order-confirmation page, call this once. It is sent only when the visitor has consented to analytics. Shopify stores use the checkout pixel instead.">
        <pre className="num overflow-x-auto rounded-xl border border-line bg-canvas/70 p-4 text-xs leading-relaxed text-ink-2">{`window.ConvertFlow && window.ConvertFlow.trackPurchase &&
  window.ConvertFlow.trackPurchase({ orderId: "1001", total: 59.9, currency: "USD" });`}</pre>
      </Section>

      <Section icon={Trash2} title="Delete account" danger sub="Permanently deletes your login, workspace, stores, campaigns and analytics. This cannot be undone.">
        <div className="flex max-w-md gap-2">
          <Input type="password" aria-label="Confirm password" placeholder="Confirm your password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          <Button variant="danger" busy={busy === "delete"} disabled={!delPw} onClick={() => { if (window.confirm("Permanently delete your account and all data?")) void run("delete", async () => { await api("/api/v1/auth/account", { method: "DELETE", body: { password: delPw } }); window.location.href = "/"; }); }}>Delete account</Button>
        </div>
      </Section>

      <Section icon={Unplug} title="Disconnect store" danger sub="Stops serving campaigns immediately and removes stored platform credentials. To remove the snippet, delete the script tag from your storefront.">
        <Button variant="danger" busy={busy === "disconnect"} disabled={myRole !== "owner"} onClick={() => { if (window.confirm(`Disconnect ${store.name}? Campaigns will stop showing immediately.`)) void run("disconnect", async () => { await api(base, { method: "DELETE" }); await reload(); }); }}>Disconnect {store.name}</Button>
      </Section>
      </div>
    </>
  );
}

export default function Page() { return <NeedStore>{(s) => <Settings store={s} />}</NeedStore>; }
