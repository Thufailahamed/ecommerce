"use client";
import clsx from "clsx";
import Link from "next/link";
import { Fragment, use, useCallback, useEffect, useState } from "react";
import { ChevronLeft, Download, Inbox, Mail, Receipt } from "lucide-react";
import { formatMoney } from "@convertflow/store-builder";
import { ApiError } from "@/lib/api";
import { builder, type OrderRow, type SiteView, type SubmissionRow } from "@/lib/builder";
import { Badge, Button, Empty, ErrorNote, Metric, PageHeader, Skeleton, tableClass } from "@/components/ui";

const STATUS: Record<OrderRow["status"], { label: string; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  pending_payment: { label: "Awaiting payment", tone: "warn" }, unpaid: { label: "Unpaid", tone: "warn" }, paid: { label: "Paid", tone: "ok" },
  fulfilled: { label: "Fulfilled", tone: "neutral" }, cancelled: { label: "Cancelled", tone: "danger" },
};

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => { const s = String(c); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; }).join(",")).join("\n");

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function OrdersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [site, setSite] = useState<SiteView | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [subs, setSubs] = useState<SubmissionRow[] | null>(null);
  const [tab, setTab] = useState<"orders" | "newsletter" | "contact">("orders");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, o, f] = await Promise.all([builder.get(id), builder.orders(id), builder.submissions(id)]);
      setSite(s); setOrders(o); setSubs(f);
    } catch (e) { setError(e instanceof ApiError && e.status === 403 ? "Your role can't see orders for this store." : e instanceof Error ? e.message : "Could not load orders"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const setStatus = async (o: OrderRow, status: "paid" | "fulfilled" | "cancelled") => {
    try { await builder.setOrderStatus(id, o.id, status); setOrders((list) => list?.map((x) => (x.id === o.id ? { ...x, status } : x)) ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update the order"); }
  };

  const paid = (orders ?? []).filter((o) => o.status === "paid" || o.status === "fulfilled");
  const currency = orders?.[0]?.currency ?? site?.draft.settings.currency ?? "USD";
  const revenue = paid.reduce((s, o) => s + o.total, 0);
  const newsletter = (subs ?? []).filter((s) => s.kind === "newsletter");
  const contact = (subs ?? []).filter((s) => s.kind === "contact");

  return (
    <div>
      <Link href="/app/sites" className="mb-4 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink"><ChevronLeft className="size-4" aria-hidden />Stores</Link>
      <PageHeader eyebrow={site?.name ?? "Store"} title="Orders and messages" sub="Orders placed on your published store, newsletter sign-ups and contact messages."
        actions={site && <Link href={`/builder/${id}`} className="inline-flex h-10 items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink hover:bg-ink/[0.06]">Open builder</Link>} />
      <ErrorNote error={error} />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <Metric label="Orders" value={orders ? String(orders.length) : "–"} icon={Receipt} />
        <Metric label="Paid revenue" value={orders ? formatMoney(revenue, currency) : "–"} note="Paid and fulfilled orders" />
        <Metric label="Subscribers" value={subs ? String(newsletter.length) : "–"} icon={Mail} />
      </div>

      <div role="tablist" aria-label="Records" className="mb-4 flex gap-1 rounded-full border border-line bg-ink/[0.02] p-1 sm:w-fit">
        {([["orders", `Orders · ${orders?.length ?? 0}`], ["newsletter", `Newsletter · ${newsletter.length}`], ["contact", `Messages · ${contact.length}`]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={clsx("h-8 flex-1 rounded-full px-4 text-[13px] font-medium transition-colors", tab === k ? "bg-ink/[0.1] text-ink" : "text-ink-3 hover:text-ink")}>{label}</button>
        ))}
      </div>

      {orders === null ? <Skeleton className="h-64 rounded-3xl" /> : tab === "orders" ? (
        orders.length === 0 ? <Empty title="No orders yet" body="When shoppers check out on your published store, their orders appear here and you get an email." icon={Receipt} /> : (
          <div className="card overflow-x-auto">
            <table className={tableClass}>
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-3"><th>Order</th><th>Customer</th><th>Status</th><th className="text-right">Total</th><th>Placed</th><th /></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <Fragment key={o.id}>
                    <tr className="cursor-pointer" onClick={() => setOpen(open === o.id ? null : o.id)}>
                      <td className="num font-medium">#{o.number}</td>
                      <td><div className="text-ink">{o.name}</div><div className="text-[12px] text-ink-3">{o.email}</div></td>
                      <td><Badge tone={STATUS[o.status].tone} dot>{STATUS[o.status].label}</Badge></td>
                      <td className="num text-right">{formatMoney(o.total, o.currency)}</td>
                      <td className="text-[12px] text-ink-3">{new Date(o.createdAt).toLocaleString()}</td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {o.status === "unpaid" && <Button variant="ghost" onClick={() => void setStatus(o, "paid")}>Mark paid</Button>}
                          {o.status === "paid" && <Button variant="ghost" onClick={() => void setStatus(o, "fulfilled")}>Mark fulfilled</Button>}
                          {(o.status === "unpaid" || o.status === "pending_payment") && <Button variant="ghost" onClick={() => void setStatus(o, "cancelled")}>Cancel</Button>}
                        </div>
                      </td>
                    </tr>
                    {open === o.id && (
                      <tr>
                        <td colSpan={6} className="bg-ink/[0.02]">
                          <div className="grid gap-6 py-2 md:grid-cols-2">
                            <ul className="space-y-1 text-[13px]">
                              {o.lines.map((l, i) => <li key={i} className="flex justify-between gap-4"><span>{l.quantity} × {l.title}{Object.keys(l.options).length ? <span className="text-ink-3"> · {Object.values(l.options).join(" / ")}</span> : null}</span><span className="num">{formatMoney(l.lineTotal, o.currency)}</span></li>)}
                              <li className="flex justify-between gap-4 border-t border-line pt-1 text-ink-3"><span>Shipping</span><span className="num">{formatMoney(o.shipping, o.currency)}</span></li>
                            </ul>
                            <div className="text-[13px] leading-relaxed text-ink-2">
                              <div className="font-medium text-ink">Ship to</div>
                              {[o.address["address1"], o.address["address2"], [o.address["city"], o.address["region"], o.address["postalCode"]].filter(Boolean).join(", "), o.address["country"], o.address["phone"]].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                              {o.note && <p className="mt-2 text-ink-3">Note: {o.note}</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        (() => {
          const list = tab === "newsletter" ? newsletter : contact;
          if (list.length === 0) return <Empty title={tab === "newsletter" ? "No subscribers yet" : "No messages yet"} body={tab === "newsletter" ? "Sign-ups from your store's newsletter sections appear here." : "Messages from your store's contact form appear here."} icon={Inbox} />;
          return (
            <>
              <div className="mb-3 flex justify-end">
                <Button onClick={() => download(`${site?.slug ?? "store"}-${tab}.csv`, csv([tab === "newsletter" ? ["email", "signed_up"] : ["name", "email", "message", "sent"], ...list.map((s) => (tab === "newsletter" ? [s.email, s.createdAt] : [s.name ?? "", s.email, s.message ?? "", s.createdAt]))]))}>
                  <Download className="size-4" aria-hidden />Export CSV
                </Button>
              </div>
              <div className="card overflow-x-auto">
                <table className={tableClass}>
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-3">{tab === "contact" && <th>Name</th>}<th>Email</th>{tab === "contact" && <th>Message</th>}<th>Date</th></tr></thead>
                  <tbody>
                    {list.map((s) => (
                      <tr key={s.id}>
                        {tab === "contact" && <td className="whitespace-nowrap">{s.name}</td>}
                        <td><a href={`mailto:${s.email}`} className="text-brand hover:underline">{s.email}</a></td>
                        {tab === "contact" && <td className="max-w-md whitespace-pre-wrap text-ink-2">{s.message}</td>}
                        <td className="whitespace-nowrap text-[12px] text-ink-3">{new Date(s.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
