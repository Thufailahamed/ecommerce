import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@convertflow/database";
import { formatMoney, priceCart, type CartLine } from "@convertflow/store-builder";
import { HttpError, type Deps } from "../../deps.js";
import { newId, randomToken, sha256Hex } from "../../lib/crypto.js";
import { getPublished, stripeKeyOf, type PublishedSite } from "./sites.js";

const { siteOrders, siteSubmissions, sites } = schema;

const EmailAddress = z.email().max(254).transform((s) => s.trim().toLowerCase());
const Field = (max: number) => z.string().trim().min(1).max(max).transform((s) => s.replace(/[\u0000-\u001f<>]/g, ""));
const OptField = (max: number) => z.string().trim().max(max).transform((s) => s.replace(/[\u0000-\u001f<>]/g, "")).optional();

export const CheckoutInput = z.object({
  lines: z.array(z.object({ productId: z.string().min(1).max(60), quantity: z.number().int().min(1).max(99), options: z.record(z.string().max(30), z.string().max(40)).optional() })).min(1).max(50),
  customer: z.object({
    email: EmailAddress, name: Field(120),
    address1: Field(200), address2: OptField(200), city: Field(100), region: OptField(100), postalCode: Field(20), country: Field(60),
    phone: OptField(40),
  }),
  note: OptField(500),
});

async function published(d: Deps, slug: string): Promise<PublishedSite> {
  const pub = await getPublished(d, slug);
  if (!pub) throw new HttpError(404, "not_found", "Store not found");
  return pub;
}

/** Amounts in the smallest currency unit, as Stripe wants them. Zero-decimal currencies (JPY, KRW) have no cents. */
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
const minor = (amount: number, currency: string) => Math.round(ZERO_DECIMAL.has(currency) ? amount : amount * 100);

/**
 * Places an order. Lines are priced from the published catalogue (never from the browser). With the merchant's Stripe
 * key connected the shopper is sent to Stripe Checkout and the order stays `pending_payment` until Stripe confirms
 * payment; without it the order is recorded `unpaid` and the merchant arranges payment.
 */
export async function placeOrder(d: Deps, slug: string, input: z.infer<typeof CheckoutInput>) {
  const pub = await published(d, slug);
  const priced = priceCart(pub.doc, input.lines as CartLine[]);
  if (priced.lines.length === 0) throw new HttpError(422, "empty_cart", priced.issues[0] ?? "Your cart is empty.", priced.issues);
  if (priced.issues.length) throw new HttpError(409, "cart_changed", "Your cart changed. Please review it and try again.", priced.issues);

  const stripeKey = pub.payments ? await stripeKeyOf(d, pub.siteId) : null;
  const token = randomToken(24);
  const id = newId("ord").toLowerCase().replace(/[^a-z0-9_]/g, "x");
  const ts = d.now().toISOString();
  const { customer } = input;
  // Numbers are per store and human-friendly; the unique index makes a racing duplicate fail rather than collide.
  for (let attempt = 0; ; attempt++) {
    const [{ max } = { max: 1000 }] = await d.db.select({ max: sql<number>`coalesce(max(${siteOrders.number}), 1000)` }).from(siteOrders).where(eq(siteOrders.siteId, pub.siteId));
    try {
      await d.db.insert(siteOrders).values({
        id, siteId: pub.siteId, number: Number(max) + 1, status: stripeKey ? "pending_payment" : "unpaid",
        email: customer.email, name: customer.name,
        address: Object.fromEntries(Object.entries({ address1: customer.address1, address2: customer.address2, city: customer.city, region: customer.region, postalCode: customer.postalCode, country: customer.country, phone: customer.phone }).filter(([, v]) => v)) as Record<string, string>,
        lines: priced.lines, currency: priced.currency, subtotal: priced.subtotal, shipping: priced.shipping, total: priced.total,
        note: input.note ?? null, paymentRef: null, accessHash: await sha256Hex(token), createdAt: ts, updatedAt: ts,
      });
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
  const [order] = await d.db.select().from(siteOrders).where(eq(siteOrders.id, id)).limit(1);
  const web = d.secrets?.webOrigin ?? "";
  const orderUrl = `${web}/s/${slug}/orders/${id}?token=${token}`;

  if (stripeKey) {
    const form = new URLSearchParams({
      mode: "payment", customer_email: customer.email, client_reference_id: id, "metadata[order_id]": id, "metadata[site]": slug,
      success_url: `${orderUrl}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${web}/s/${slug}/cart`,
    });
    const items = [...priced.lines.map((l) => ({ name: [l.title, ...Object.values(l.options)].join(" · "), amount: l.unitPrice, qty: l.quantity })), ...(priced.shipping > 0 ? [{ name: "Shipping", amount: priced.shipping, qty: 1 }] : [])];
    items.forEach((it, i) => {
      form.set(`line_items[${i}][price_data][currency]`, priced.currency.toLowerCase());
      form.set(`line_items[${i}][price_data][product_data][name]`, it.name.slice(0, 250));
      form.set(`line_items[${i}][price_data][unit_amount]`, String(minor(it.amount, priced.currency)));
      form.set(`line_items[${i}][quantity]`, String(it.qty));
    });
    const res = await (d.fetchFn ?? fetch)("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST", headers: { authorization: `Bearer ${stripeKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": id }, body: form.toString(),
    }).catch(() => null);
    const j = res ? ((await res.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null) : null;
    if (!res?.ok || !j?.url || !j.id) {
      await d.db.update(siteOrders).set({ status: "cancelled", updatedAt: d.now().toISOString() }).where(eq(siteOrders.id, id));
      throw new HttpError(502, "payment_unavailable", "Payment could not be started. Please try again in a moment.");
    }
    await d.db.update(siteOrders).set({ paymentRef: j.id }).where(eq(siteOrders.id, id));
    return { orderId: id, number: order!.number, token, redirectUrl: j.url };
  }

  await notify(d, pub, order!, orderUrl);
  return { orderId: id, number: order!.number, token, redirectUrl: null };
}

/** The shopper's view of their order, readable only with the token from their confirmation link. */
export async function getOrder(d: Deps, slug: string, orderId: string, token: string) {
  const pub = await published(d, slug);
  const [order] = await d.db.select().from(siteOrders).where(and(eq(siteOrders.id, orderId), eq(siteOrders.siteId, pub.siteId))).limit(1);
  if (!order || !token || (await sha256Hex(token)) !== order.accessHash) throw new HttpError(404, "not_found", "Order not found");
  let current = order;
  if (order.status === "pending_payment" && order.paymentRef) {
    const key = await stripeKeyOf(d, pub.siteId);
    const res = key ? await (d.fetchFn ?? fetch)(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(order.paymentRef)}`, { headers: { authorization: `Bearer ${key}` } }).catch(() => null) : null;
    const j = res?.ok ? ((await res.json()) as { payment_status?: string; client_reference_id?: string }) : null;
    // The session must be the one created for this order: a link with another paid session id proves nothing.
    if (j?.payment_status === "paid" && j.client_reference_id === order.id) {
      await d.db.update(siteOrders).set({ status: "paid", updatedAt: d.now().toISOString() }).where(and(eq(siteOrders.id, order.id), eq(siteOrders.status, "pending_payment")));
      current = { ...order, status: "paid" };
      await notify(d, pub, current, `${d.secrets?.webOrigin ?? ""}/s/${slug}/orders/${order.id}?token=${token}`);
    }
  }
  return {
    id: current.id, number: current.number, status: current.status, email: current.email, name: current.name,
    lines: current.lines, currency: current.currency, subtotal: current.subtotal, shipping: current.shipping, total: current.total, createdAt: current.createdAt,
  };
}

/** Best effort: a store must not lose an order because an email failed. */
async function notify(d: Deps, pub: PublishedSite, order: typeof siteOrders.$inferSelect, orderUrl: string) {
  if (!d.email) return;
  const money = (n: number) => formatMoney(n, order.currency);
  const lines = (order.lines as { title: string; quantity: number; lineTotal: number }[]).map((l) => `${l.quantity} × ${l.title}  ${money(l.lineTotal)}`).join("\n");
  const summary = `${lines}\n\nSubtotal ${money(order.subtotal)}\nShipping ${money(order.shipping)}\nTotal ${money(order.total)}`;
  const paid = order.status === "paid";
  try {
    await d.email.send({
      to: order.email, subject: `${pub.doc.brand.name}: order #${order.number} ${paid ? "confirmed" : "received"}`,
      text: `Thanks for your order, ${order.name}.\n\n${summary}\n\n${paid ? "Your payment was received." : "The store will contact you about payment and delivery."}\n\nView your order: ${orderUrl}`,
    });
    const [s] = await d.db.select({ notifyEmail: sites.notifyEmail }).from(sites).where(eq(sites.id, pub.siteId)).limit(1);
    const merchant = s?.notifyEmail ?? pub.doc.settings.contactEmail;
    if (merchant && z.email().safeParse(merchant).success) {
      await d.email.send({ to: merchant, subject: `New order #${order.number} (${paid ? "paid" : "awaiting payment"}) on ${pub.doc.brand.name}`, text: `${order.name} <${order.email}>\n\n${summary}` });
    }
  } catch (e) {
    console.error(JSON.stringify({ level: "warn", where: "builder.notify", message: e instanceof Error ? e.message : String(e) }));
  }
}

export const FormInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("newsletter"), email: EmailAddress }),
  z.object({ kind: z.literal("contact"), email: EmailAddress, name: Field(120), message: Field(4000) }),
]);

export async function submitForm(d: Deps, slug: string, input: z.infer<typeof FormInput>) {
  const pub = await published(d, slug);
  if (input.kind === "newsletter") {
    const [dup] = await d.db.select({ id: siteSubmissions.id }).from(siteSubmissions).where(and(eq(siteSubmissions.siteId, pub.siteId), eq(siteSubmissions.kind, "newsletter"), eq(siteSubmissions.email, input.email))).limit(1);
    if (dup) return; // same answer either way: no way to probe who is subscribed
  }
  await d.db.insert(siteSubmissions).values({
    id: newId("sub"), siteId: pub.siteId, kind: input.kind, email: input.email,
    name: input.kind === "contact" ? input.name : null, message: input.kind === "contact" ? input.message : null, createdAt: d.now().toISOString(),
  });
  if (input.kind === "contact" && d.email) {
    const [s] = await d.db.select({ notifyEmail: sites.notifyEmail }).from(sites).where(eq(sites.id, pub.siteId)).limit(1);
    const to = s?.notifyEmail ?? pub.doc.settings.contactEmail;
    if (to && z.email().safeParse(to).success) {
      await d.email.send({ to, subject: `Message from ${input.name} via ${pub.doc.brand.name}`, text: `${input.name} <${input.email}> wrote:\n\n${input.message}`, headers: { "reply-to": input.email } }).catch(() => undefined);
    }
  }
}

/* ---------- merchant side ---------- */

export async function listOrders(d: Deps, siteId: string) {
  return d.db.select({
    id: siteOrders.id, number: siteOrders.number, status: siteOrders.status, email: siteOrders.email, name: siteOrders.name, address: siteOrders.address,
    lines: siteOrders.lines, currency: siteOrders.currency, subtotal: siteOrders.subtotal, shipping: siteOrders.shipping, total: siteOrders.total, note: siteOrders.note, createdAt: siteOrders.createdAt,
  }).from(siteOrders).where(eq(siteOrders.siteId, siteId)).orderBy(desc(siteOrders.createdAt)).limit(500);
}

/** Merchants move orders forward by hand; paid is only ever set by a confirmed payment or by the merchant for offline payment. */
export async function setOrderStatus(d: Deps, siteId: string, orderId: string, status: "paid" | "fulfilled" | "cancelled") {
  const rows = await d.db.update(siteOrders).set({ status, updatedAt: d.now().toISOString() }).where(and(eq(siteOrders.id, orderId), eq(siteOrders.siteId, siteId))).returning({ id: siteOrders.id });
  if (!rows[0]) throw new HttpError(404, "not_found", "Order not found");
}

export async function listSubmissions(d: Deps, siteId: string) {
  return d.db.select().from(siteSubmissions).where(eq(siteSubmissions.siteId, siteId)).orderBy(desc(siteSubmissions.createdAt)).limit(1000);
}
