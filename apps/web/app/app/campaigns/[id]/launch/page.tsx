"use client";
import { use, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api, ApiError, API_URL, type CampaignRow, type Store } from "@/lib/api";
import { useApi } from "@/lib/use-api";
import { NeedStore } from "@/components/need-store";
import { CampaignSteps } from "@/components/campaign-steps";
import { Badge, Button, ErrorNote, Notice, PageHeader, SectionTitle, Skeleton } from "@/components/ui";

const SDK_URL = process.env.NEXT_PUBLIC_SDK_URL ?? "http://localhost:8788";

interface Integration { snippet: string; configPublished: boolean }
interface Cond { field: string; op: string; value: unknown; valueTo?: number }
interface Trigger { type: string; seconds?: number; percent?: number; subtotal?: number }

const FIELD: Record<string, string> = {
  page_type: "Page type", url_path: "URL", device: "Device", cart_subtotal: "Cart subtotal", cart_item_count: "Items in cart",
  product_id: "Product", collection_id: "Collection", visitor_type: "Visitor", pages_viewed: "Pages viewed", product_available: "Product in stock",
};
const OP: Record<string, string> = { in: "is one of", not_in: "is not one of", equals: "is", starts_with: "starts with", contains: "contains", gte: "at least", lte: "at most", between: "between" };

/** A targeting rule as a plain sentence, e.g. "Page type is one of product, collection". */
export const describeCondition = (c: Cond): string => {
  const v = Array.isArray(c.value) ? c.value.join(", ") : typeof c.value === "boolean" ? (c.value ? "yes" : "no") : String(c.value);
  const to = c.op === "between" ? ` and ${c.valueTo}` : "";
  return `${FIELD[c.field] ?? c.field} ${OP[c.op] ?? c.op} ${v}${to}`;
};

export const describeTrigger = (t: Trigger | undefined): string => {
  switch (t?.type) {
    case "immediate": return "Right away when the page loads";
    case "delay": return `After ${t.seconds ?? 0} seconds`;
    case "scroll_depth": return `When the shopper scrolls ${t.percent ?? 0}% down the page`;
    case "exit_intent": return "When the shopper moves to leave the page";
    case "idle": return `After ${t.seconds ?? 0} seconds without activity`;
    case "add_to_cart": return "When something is added to the cart";
    case "cart_threshold": return `When the cart reaches ${t.subtotal ?? 0}`;
    default: return "Not set";
  }
};

/** Platforms the install step lists. Only the universal snippet is available; the rest are shown so the path is visible. */
const PLATFORMS = [
  { name: "Any website", note: "Paste the snippet before </body> on every page. Works on every platform.", available: true },
  { name: "WordPress", note: "Plugin install. Not built yet.", available: false },
  { name: "Shopify", note: "Theme or app embed. Not verified on a live store yet.", available: false },
  { name: "Google Tag Manager", note: "Tag setup. Not built yet.", available: false },
  { name: "Segment", note: "Event forwarding. Not built yet.", available: false },
];

function Launch({ store, id }: { store: Store; id: string }) {
  const campaign = useApi<CampaignRow>(`/api/v1/stores/${store.id}/campaigns/${id}`);
  const integ = useApi<Integration>(`/api/v1/stores/${store.id}/integration`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const status = campaign.data?.status;
  const live = status === "active" || status === "scheduled";
  const canToggle = status === "active" || status === "scheduled" || status === "paused";
  const draft = (campaign.data?.draftConfig ?? {}) as { targeting?: { match: "all" | "any"; conditions: Cond[] }; trigger?: Trigger };
  const conditions = draft.targeting?.conditions ?? [];
  const snippet = integ.data?.snippet.replace("{SDK_URL}", SDK_URL).replace("{API_URL}", API_URL) ?? "";

  const toggle = async () => {
    setActionError(null);
    setBusy(true);
    try {
      await api(`/api/v1/stores/${store.id}/campaigns/${id}/${live ? "pause" : "resume"}`, { method: "POST", body: {} });
      await campaign.reload();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Could not change the campaign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CampaignSteps id={id} current="launch" />
      <PageHeader eyebrow="Campaign" title={campaign.data ? `Launch: ${campaign.data.name}` : "Launch"} sub="Decide who sees this campaign, switch it on, and confirm the snippet is on your site." />
      <ErrorNote error={campaign.error ?? actionError} />
      {(campaign.loading || integ.loading) && <Skeleton className="h-64" />}

      {campaign.data && (
        <div className="grid gap-6">
          {/* 1. Switch on */}
          <section aria-labelledby="launch-switch" className="card flex flex-wrap items-center justify-between gap-4 p-6">
            <div>
              <h2 id="launch-switch" className="font-medium">Launch your campaign</h2>
              <p className="mt-1 text-sm text-ink-2">
                {status === "draft" && "This campaign is a draft. Publish it from the Builder first; nothing goes live until it is published."}
                {status === "archived" && "Archived campaigns cannot go live. Duplicate it to make a new one."}
                {live && "Live. Eligible shoppers see it on your storefront."}
                {status === "paused" && "Paused. Switch on to show it to eligible shoppers again."}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={live ? "ok" : "neutral"} dot>{status ?? "–"}</Badge>
              <button type="button" role="switch" aria-checked={live} aria-label="Launch your campaign" disabled={!canToggle || busy}
                onClick={() => void toggle()}
                className={`relative h-6 w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${live ? "bg-brand-solid" : "bg-white/[0.12]"}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${live ? "left-[22px]" : "left-0.5"}`} aria-hidden />
              </button>
            </div>
          </section>

          {/* 2. Who sees it */}
          <section aria-labelledby="launch-target" className="card p-6">
            <SectionTitle id="launch-target" sub="Set in the Builder's Audience tab. Shoppers must match these rules to see the campaign.">Targeting</SectionTitle>
            <p className="mt-4 text-sm text-ink-2">
              {conditions.length === 0
                ? "Everywhere: no conditions, so every eligible shopper sees it."
                : draft.targeting?.match === "any"
                  ? "Show when ANY of these conditions match:"
                  : "Show when ALL of these conditions match:"}
            </p>
            {conditions.length > 0 && (
              <ul className="mt-3 flex flex-col gap-2">
                {conditions.map((c, i) => (
                  <li key={i} className="rounded-xl border border-line bg-canvas/60 px-4 py-2.5 text-sm">{describeCondition(c)}</li>
                ))}
              </ul>
            )}
            <p className="mt-5 text-sm text-ink-2"><span className="text-ink-3">When it appears: </span>{describeTrigger(draft.trigger)}</p>
          </section>

          {/* 3. Install */}
          <section aria-labelledby="launch-install" className="card p-6">
            <SectionTitle id="launch-install" sub="One snippet serves every campaign on this store. Add it once, to every page.">Install the code</SectionTitle>
            {integ.data && !integ.data.configPublished && (
              <div className="mt-4"><Notice>No campaign is live yet, so the snippet has nothing to show. Switch this campaign on, then check the snippet is on your site.</Notice></div>
            )}
            <pre tabIndex={0} className="num mt-4 overflow-x-auto rounded-xl border border-line bg-canvas/70 p-4 text-xs leading-relaxed text-ink-2">{snippet || "Loading…"}</pre>
            <div className="mt-3">
              <Button onClick={async () => { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!snippet}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{copied ? "Copied" : "Copy snippet"}
              </Button>
            </div>
          </section>

          {/* 4. Platforms */}
          <section aria-labelledby="launch-platforms" className="card p-6">
            <SectionTitle id="launch-platforms" sub="Platform connections. Only the universal snippet works today; the others are planned.">Connect to your website platform</SectionTitle>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {PLATFORMS.map((p) => (
                <li key={p.name} className="rounded-xl border border-line bg-canvas/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    {p.available ? <Badge tone="ok" dot>Available</Badge> : <Badge>Soon</Badge>}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-ink-3">{p.note}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <NeedStore>{(s) => <Launch store={s} id={id} />}</NeedStore>;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Inner params={params} />;
}
