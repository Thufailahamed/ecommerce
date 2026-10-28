"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, BadgePercent, Bell, CalendarClock, Gauge, Inbox, MailCheck, ShieldCheck, ShoppingCart, Tag, Unlink } from "lucide-react";
import { BarMock, FeedMock, Photo, PopupMock, RestockMock, SlideInMock, STORES, StoreMock, ToastMock, UpsellMock, type Product, type StoreName } from "./art";
import { Scaled } from "./fx";

/* ---------- Industries: one store per vertical, each with the campaign it would most likely start with ---------- */

type Industry = { id: string; label: string; store: StoreName; accent: string; hero: Product; products: Product[]; title: string; body: string; tool: string; audience: string; delivery: string; overlay: ReactNode };

const INDUSTRIES: Industry[] = [
  { id: "beauty", label: "Beauty", store: "Lumen Skin", accent: "#8a3b55", ...STORES["Lumen Skin"],
    title: "Grow a list that actually opted in", body: "An email signup with an unticked consent box and double opt-in. The welcome code is revealed only after the subscriber confirms.", tool: "Email signup",
    audience: "New visitor AND viewed 2+ products", delivery: "Popup · after 10 seconds · 1 per visitor",
    overlay: <PopupMock title="First access to new shades" body="Join the list for launches and restocks. Unsubscribe any time." cta="Sign me up" product="p-cream" email /> },
  { id: "fashion", label: "Fashion", store: "Field & Thread", accent: "#0a0c14", ...STORES["Field & Thread"],
    title: "Complete the look in the cart", body: "Rule-based recommendations from your own catalog: your picks, a collection, or whatever closes the free-shipping gap. Added to cart without leaving the page.", tool: "Upsells",
    audience: "Cart contains a tee", delivery: "Cart drawer · in-stock items only",
    overlay: <UpsellMock items={["p-sneaker", "p-watch", "p-backpack"]} /> },
  { id: "home", label: "Home", store: "Hearth Home", accent: "#4a5a3c", ...STORES["Hearth Home"],
    title: "Nudge basket value, not margin", body: "A free-shipping bar for shoppers who are close, and a slide-in that points at the collection they are browsing. No discount unless you authorise one.", tool: "Announcement bar + slide-in",
    audience: "Cart subtotal at least $40", delivery: "Bar · immediately · slide-in at 50% scroll",
    overlay: <><BarMock text="You are $18 away from free shipping" /><SlideInMock title="Pair it with our reading chair" cta="View chairs" product="p-chair" /></> },
  { id: "health", label: "Health", store: "Daily Form", accent: "#1d6b4c", ...STORES["Daily Form"],
    title: "Turn sold-out into a waiting list", body: "Shoppers opt in on a sold-out product and get one alert when it returns. Double opt-in, one-click unsubscribe, and stock that is unknown stays unknown.", tool: "Back-in-stock alerts",
    audience: "Product page AND item is out of stock", delivery: "Inline form · one email per restock",
    overlay: <RestockMock product="p-jar" /> },
  { id: "pets", label: "Pets", store: "Good Boy Co.", accent: "#c4542a", ...STORES["Good Boy Co."],
    title: "Say it without blocking the page", body: "A small toast for launches and shipping news that never covers the product. Capped per session, so regulars are not nagged.", tool: "Toasts",
    audience: "Returning visitor", delivery: "Toast · after 5 seconds · 1 per session",
    overlay: <ToastMock text="New: chew-proof toys" sub="Built for the toughest chewers" /> },
  { id: "tech", label: "Tech", store: "Signal Audio", accent: "#2350ff", ...STORES["Signal Audio"],
    title: "Help undecided shoppers compare", body: "A slide-in for shoppers who have viewed several products, pointing to a comparison page on your own site. Every link stays on your store.", tool: "Slide-in",
    audience: "Product page AND viewed 3+ pages", delivery: "Slide-in · at 50% scroll · 1 per session",
    overlay: <SlideInMock title="Still deciding? Compare our 3 most-viewed headphones" cta="Compare" product="p-headphones-pink" /> },
  { id: "outdoor", label: "Outdoor", store: "Northpeak", accent: "#0a0c14", ...STORES["Northpeak"],
    title: "A bell shoppers can come back to", body: "A notification feed that stays on the page. Each campaign is one card that can be scheduled and expire; read state stays in the shopper's browser.", tool: "Notification feed",
    audience: "All visitors", delivery: "Feed · scheduled launch Friday 09:00",
    overlay: <FeedMock /> },
];

export function Industries() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => setI((v) => (v + 1) % INDUSTRIES.length), 6000);
    return () => clearInterval(t);
  }, [auto]);
  const ind = INDUSTRIES[i]!;
  return (
    <div onMouseEnter={() => setAuto(false)} onFocus={() => setAuto(false)}>
      <div role="tablist" aria-label="Industry" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
        {INDUSTRIES.map((x, k) => (
          <button key={x.id} role="tab" aria-selected={i === k} onClick={() => { setI(k); setAuto(false); }}
            className={`relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-full py-1.5 pl-1.5 pr-5 text-[14px] font-semibold transition-all duration-300 ${i === k ? "bg-[#0a0c14] text-white shadow-[0_12px_30px_-12px_rgba(10,12,20,.6)]" : "bg-white text-ink-2 ring-1 ring-black/10 hover:-translate-y-0.5 hover:text-ink"}`}>
            <span className="size-8 overflow-hidden rounded-full"><Photo k={STORES[x.store].hero} w={100} className="size-full" /></span>
            {x.label}
            {i === k && auto && <span key={i} aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-[#2350ff] [animation:progress_6s_linear_both]" />}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.55fr]" role="tabpanel" aria-label={ind.label}>
        <div key={`t-${ind.id}`} className="reveal spot flex flex-col rounded-[1.5rem] bg-white p-6 ring-1 ring-black/5 md:p-8">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#eef2ff] px-3 py-1 text-[12px] font-semibold text-[#2350ff]"><Tag className="size-3.5" aria-hidden />{ind.tool}</span>
          <h3 className="mt-5 font-display text-[clamp(1.375rem,2.2vw,2rem)] font-bold uppercase leading-tight">{ind.title}</h3>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{ind.body}</p>
          <dl className="mt-6 grid gap-3 border-t border-black/10 pt-5 text-[14px]">
            <div className="grid grid-cols-[6rem_1fr] gap-3"><dt className="text-ink-3">Audience</dt><dd className="font-medium">{ind.audience}</dd></div>
            <div className="grid grid-cols-[6rem_1fr] gap-3"><dt className="text-ink-3">Delivery</dt><dd className="font-medium">{ind.delivery}</dd></div>
          </dl>
          <Link href="/signup" className="btn btn-primary mt-8 w-fit lg:mt-auto">Build this campaign <ArrowRight className="size-4" aria-hidden /></Link>
        </div>
        <div className="overflow-hidden rounded-[1.5rem] bg-[#0a0c14] p-2 shadow-[0_40px_80px_-40px_rgba(35,80,255,.6)] md:p-3">
          <div className="flex items-center gap-1.5 px-2 pb-2 pt-1"><span className="size-2 rounded-full bg-white/20" /><span className="size-2 rounded-full bg-white/20" /><span className="size-2 rounded-full bg-white/20" /><span className="num mx-auto truncate text-[11px] text-white/40">{ind.store.toLowerCase().replace(/[^a-z]+/g, "")}.com</span></div>
          <div className="overflow-hidden rounded-xl">
            <Scaled width={800} height={500}>
              <StoreMock key={ind.id} name={ind.store} hero={ind.hero} products={ind.products} accent={ind.accent} tagline={`${ind.label} · new arrivals`}>
                <div key={ind.id} className="absolute inset-0">{ind.overlay}</div>
              </StoreMock>
            </Scaled>
          </div>
          <p className="px-2 pb-1 pt-2 text-[11px] text-white/40">Illustrative store and campaign</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Flows: how one use case plays out, step by step ---------- */

type Step = { title: string; body: string; visual: ReactNode };
const mini = (overlay: ReactNode, name: StoreName) => (
  <Scaled width={600} height={380}><StoreMock name={name} {...STORES[name]} cols={4}>{overlay}</StoreMock></Scaled>
);
const card = (Icon: typeof Bell, lines: [string, string][]) => (
  <div className="grid aspect-[600/380] place-items-center bg-[radial-gradient(circle_at_50%_0%,rgba(35,80,255,.35),transparent_70%)] p-4">
    <div className="w-full max-w-[85%] rounded-xl bg-[#12141c] p-3 ring-1 ring-white/10">
      <span className="grid size-8 place-items-center rounded-lg bg-[#2350ff]"><Icon className="size-4 text-white" aria-hidden /></span>
      {lines.map(([a, b]) => <div key={a} className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px]"><span className="text-white/60">{a}</span><span className="font-semibold text-white">{b}</span></div>)}
    </div>
  </div>
);

const FLOWS: { id: string; label: string; body: string; steps: Step[] }[] = [
  { id: "list", label: "Grow your list", body: "Capture subscribers with consent you can show an auditor, then hand them to the tools you already use.", steps: [
    { title: "Ask at the right moment", body: "Popup for new visitors after they have browsed a little.", visual: mini(<PopupMock title="Join for first access" body="Launches and restocks, first." cta="Subscribe" email />, "Lumen Skin") },
    { title: "Consent, unticked", body: "An explicit checkbox in your words. Nothing is pre-selected.", visual: card(ShieldCheck, [["Consent box", "Unticked"], ["Wording", "Yours"]]) },
    { title: "Double opt-in", body: "Subscribers confirm by email before they count.", visual: card(MailCheck, [["Status", "Confirmed"], ["Code", "Revealed after"]]) },
    { title: "Synced or exported", body: "Copied to Klaviyo or Mailchimp, or exported as CSV.", visual: card(Inbox, [["Klaviyo", "Connected"], ["CSV", "Ready"]]) },
  ] },
  { id: "aov", label: "Lift order value", body: "Close the gap to free shipping and suggest the next item from your own catalog, in stock only.", steps: [
    { title: "Show the gap", body: "A bar for carts close to your free-shipping threshold.", visual: mini(<BarMock text="You are $12 away from free shipping" />, "Field & Thread") },
    { title: "Recommend from the catalog", body: "Your picks, a collection, or items that close the gap.", visual: mini(<UpsellMock items={["p-sneaker", "p-watch"]} />, "Field & Thread") },
    { title: "Add without leaving", body: "Products go into the cart in place.", visual: card(ShoppingCart, [["Added", "Ridge watch"], ["Stock", "Verified"]]) },
    { title: "Measure honestly", body: "Attributed revenue is labelled as association, not lift.", visual: card(Gauge, [["Attributed", "7-day click"], ["Lift", "Holdout only"]]) },
  ] },
  { id: "restock", label: "Win back interest", body: "When something sells out, keep the shopper instead of losing them to a search for alternatives.", steps: [
    { title: "Offer an alert", body: "On sold-out product pages only.", visual: mini(<RestockMock product="p-jar" />, "Daily Form") },
    { title: "Confirm the request", body: "Double opt-in keeps the list clean.", visual: card(MailCheck, [["Request", "Confirmed"], ["Product", "Greens blend"]]) },
    { title: "One email when back", body: "A single alert when stock returns.", visual: card(Bell, [["Restocked", "Today"], ["Alerts", "Sent once"]]) },
    { title: "Easy to leave", body: "One-click unsubscribe on every alert.", visual: card(Unlink, [["Unsubscribe", "One click"], ["Data", "Removed"]]) },
  ] },
  { id: "inform", label: "Keep shoppers informed", body: "Announcements that respect the page: small, capped, scheduled and easy to find again.", steps: [
    { title: "A quiet toast", body: "Never covers the product or the buy button.", visual: mini(<ToastMock text="Free returns this month" sub="On every order" />, "Good Boy Co.") },
    { title: "A feed to reopen", body: "A bell that keeps every update in one place.", visual: mini(<FeedMock />, "Northpeak") },
    { title: "Scheduled", body: "Starts and ends on time without touching it again.", visual: card(CalendarClock, [["Starts", "Fri 09:00"], ["Ends", "Sun 23:59"]]) },
    { title: "Capped", body: "Per-session limits and suppression after dismissals.", visual: card(BadgePercent, [["Cap", "1 / session"], ["After dismiss", "Hidden"]]) },
  ] },
];

export function Flows() {
  const [f, setF] = useState(0);
  const flow = FLOWS[f]!;
  return (
    <div>
      <div role="tablist" aria-label="Use case" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {FLOWS.map((x, k) => (
          <button key={x.id} role="tab" aria-selected={f === k} onClick={() => setF(k)}
            className={`rounded-2xl p-4 text-left transition-all ${f === k ? "bg-[#2350ff] text-white shadow-[0_20px_40px_-20px_rgba(35,80,255,1)]" : "bg-surface text-ink-2 ring-1 ring-white/10 hover:text-white"}`}>
            <span className="num text-[11px] opacity-70">{String(k + 1).padStart(2, "0")}</span>
            <span className="mt-1 block font-display text-[15px] font-bold uppercase">{x.label}</span>
          </button>
        ))}
      </div>
      <p key={`b-${flow.id}`} className="reveal mt-8 max-w-2xl text-[16px] text-ink-2">{flow.body}</p>
      <ol key={flow.id} className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {flow.steps.map((s, k) => (
          <li key={s.title} className="pop-in spot group relative overflow-hidden rounded-[1.25rem] bg-surface ring-1 ring-white/10 transition-transform duration-500 [transition-timing-function:var(--ease-out)] hover:-translate-y-1" style={{ animationDelay: `${k * 110}ms` }}>
            <div className="overflow-hidden border-b border-white/10">{s.visual}</div>
            <div className="p-5">
              <span className="num text-[11px] text-brand">Step {k + 1}</span>
              <h3 className="mt-1 text-[16px] font-bold">{s.title}</h3>
              <p className="mt-1 text-[14px] text-ink-2">{s.body}</p>
            </div>
            {k < flow.steps.length - 1 && <ArrowRight aria-hidden className="absolute right-3 top-3 hidden size-4 text-white/40 xl:block" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Template gallery: two endless rows of starting points ---------- */

const TEMPLATES: { name: string; tool: string; hero: Product; products: Product[]; store: StoreName; overlay: ReactNode }[] = [
  { name: "Welcome popup", tool: "Popup", ...STORES["Northpeak"], store: "Northpeak", overlay: <PopupMock title="Welcome in" body="Take a look at what is new this week." cta="Shop new arrivals" product="p-sneaker-white" /> },
  { name: "Free-shipping bar", tool: "Bar", ...STORES["Hearth Home"], store: "Hearth Home", overlay: <BarMock text="Free shipping on orders over $75" cta="Shop" /> },
  { name: "Email signup", tool: "Email signup", ...STORES["Lumen Skin"], store: "Lumen Skin", overlay: <PopupMock title="Get launch news" body="Unsubscribe any time." cta="Subscribe" email /> },
  { name: "Back in stock", tool: "Alerts", ...STORES["Daily Form"], store: "Daily Form", overlay: <RestockMock product="p-jar" /> },
  { name: "Complete the look", tool: "Upsells", ...STORES["Field & Thread"], store: "Field & Thread", overlay: <UpsellMock items={["p-watch", "p-sneaker"]} /> },
  { name: "Compare slide-in", tool: "Slide-in", ...STORES["Signal Audio"], store: "Signal Audio", overlay: <SlideInMock title="Compare our top 3" cta="Compare" product="p-headphones-pink" /> },
  { name: "Launch toast", tool: "Toasts", ...STORES["Good Boy Co."], store: "Good Boy Co.", overlay: <ToastMock text="New: chew-proof toys" sub="Out now" /> },
  { name: "Update feed", tool: "Feed", ...STORES["Northpeak"], store: "Northpeak", overlay: <FeedMock /> },
];

function TemplateCard({ t }: { t: (typeof TEMPLATES)[number] }) {
  return (
    <figure className="group w-[300px] shrink-0 md:w-[360px]">
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-white/20 transition-transform duration-500 [transition-timing-function:var(--ease-out)] group-hover:-translate-y-1.5">
        <Scaled width={640} height={400}><StoreMock name={t.store} hero={t.hero} products={t.products}>{t.overlay}</StoreMock></Scaled>
      </div>
      <figcaption className="mt-3 flex items-center justify-between px-1 text-[14px] font-semibold text-white">{t.name}<span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium">{t.tool}</span></figcaption>
    </figure>
  );
}

export function TemplateRows() {
  const half = TEMPLATES.length / 2;
  const rows = [TEMPLATES.slice(0, half), TEMPLATES.slice(half)];
  return (
    <div className="space-y-6">
      {rows.map((row, r) => (
        <div key={r} className="marquee-pause overflow-hidden">
          <div className={`marquee ${r ? "marquee-rev" : ""}`} style={{ "--marquee-dur": "48s" } as CSSProperties}>
            {[0, 1].map((k) => <div key={k} className="flex shrink-0 gap-5 pr-5" aria-hidden={k === 1}>{[...row, ...row].map((t, j) => <TemplateCard key={`${t.name}-${j}`} t={t} />)}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}

