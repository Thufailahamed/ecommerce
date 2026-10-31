// Stand-in for Cloudflare AI Gateway so end-to-end runs exercise the real builder pipeline (the Worker's prompts, the
// streaming relay, the operation engine, the editor and the storefront) without a Cloudflare account.
// POST /v1/:account/:gateway/compat/chat/completions  (stream or not)  |  POST /v1/:account/:gateway/workers-ai/<model>
// GET /requests (what the Worker sent)  |  GET /health
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";

const requests = [];

const BRIEF = { brand: { name: "Ember & Oak", tagline: "Small-batch candles for slow evenings" }, summary: "Hand-poured soy candles", voice: "warm, calm", theme: { palette: { background: "#fbf8f3", surface: "#f1ebe1", text: "#22201c", muted: "#6f685d", primary: "#2f3b2f", primaryText: "#fbf8f3", accent: "#b5683c", border: "#e3dbcd" }, fonts: { heading: "playfair", body: "dm_sans" }, radius: "sm", buttonShape: "rounded" }, categories: ["Candles", "Gift sets"], imageStyle: "warm candlelight, linen" };
const CATALOG = {
  collections: [{ id: "candles", title: "Candles", description: "Hand-poured in small batches." }, { id: "gift_sets", title: "Gift sets", description: "Ready to give." }],
  products: [
    { id: "cedar", title: "Cedar Smoke", description: "Woody and warm.\n\nAbout 50 hours of burn time.", price: 34, category: "Candles", collection: "candles", featured: true, imagePrompt: "amber jar candle" },
    { id: "fig", title: "Fig Leaf", description: "Green and bright.", price: 32, category: "Candles", collection: "candles", options: [{ name: "Size", values: ["8oz", "12oz"] }], featured: true, imagePrompt: "green candle" },
    { id: "trio", title: "Evening Trio", description: "Three minis in a gift box.", price: 48, category: "Gift sets", collection: "gift_sets", imagePrompt: "three candles in a box" },
  ],
};
const HOME = { sections: [
  { type: "hero", heading: "Light the slow evening", subheading: "Small batches, poured by hand.", primaryCta: { label: "Shop candles", href: "/collections/candles" }, image: { alt: "Candle on linen", prompt: "candle on a linen table" }, layout: "split" },
  { type: "featured_products", heading: "Bestsellers", source: "featured", limit: 4 },
  { type: "collection_list", heading: "Shop by collection" },
  { type: "testimonials", heading: "Kind words", items: [{ quote: "The best candle I have owned.", author: "Sam" }] },
  { type: "newsletter", heading: "Join the list", body: "New scents, a few times a season." },
] };
const PAGES = {
  about: { sections: [{ type: "image_with_text", heading: "Our story", body: "We started pouring candles in a tiny kitchen.", image: { alt: "Workshop", prompt: "candle workshop" } }] },
  faq: { sections: [{ type: "faq", heading: "Questions", items: [{ question: "Do you ship?", answer: "Shipping options are shown at checkout." }] }] },
  contact: { sections: [{ type: "contact", heading: "Say hello", showForm: true }] },
  announcement: { enabled: true, text: "New autumn scents are here" },
  footerNote: "Poured in small batches.",
  seo: { title: "Ember & Oak candles", description: "Hand-poured soy candles for slow evenings." },
};

function reply(messages) {
  const system = messages[0]?.content ?? "";
  const user = messages.at(-1)?.content ?? "";
  if (system.includes("creative director")) return JSON.stringify(BRIEF);
  if (system.includes("merchandiser")) return JSON.stringify(CATALOG);
  if (system.includes("laying out the home page")) return JSON.stringify(HOME);
  if (system.includes("supporting pages")) return JSON.stringify(PAGES);
  // Edit turns: answer the one request the e2e makes, about the selected (or first) hero.
  const selected = /"id":"([a-z0-9_-]+)","type":"hero"/.exec(user)?.[1] ?? "hero";
  if (/punchier|headline/i.test(user)) {
    return `<message>Done: the hero headline is shorter and punchier now.</message>\n<ops>[{"op":"update_section","section":"${selected}","props":{"heading":"Evenings, slowed down"}}]</ops>\n<suggestions>["Add a gift guide page","Try a darker palette"]</suggestions>`;
  }
  return "<message>I can help with that. What would you like to change?</message><ops>[]</ops>";
}

/** A solid-colour PNG, so generated "photos" are real images the browser renders. */
function png(r, g, b, size = 48) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

let images = 0;
createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/health") return res.end("ok");
  if (u.pathname === "/requests") return json(200, requests);
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: u.pathname, auth: req.headers["authorization"] ?? null, model: body.model ?? null, stream: body.stream ?? false });
    if (u.pathname.endsWith("/compat/chat/completions")) {
      const text = reply(body.messages ?? []);
      const usage = { prompt_tokens: 900, completion_tokens: Math.ceil(text.length / 4) };
      if (!body.stream) return json(200, { choices: [{ message: { role: "assistant", content: text } }], usage });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const pieces = text.match(/[\s\S]{1,14}/g) ?? [];
      let i = 0;
      const tick = setInterval(() => {
        if (i < pieces.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i++] } }] })}\n\n`); return; }
        clearInterval(tick);
        res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`);
        res.end();
      }, 8);
      return;
    }
    if (u.pathname.includes("/workers-ai/")) {
      const n = images++;
      return json(200, { success: true, result: { image: png(180 - (n * 23) % 120, 120 + (n * 37) % 100, 90 + (n * 53) % 140).toString("base64") } });
    }
    json(404, { error: "not found" });
  });
}).listen(Number(process.env.E2E_AI_PORT ?? 4300), () => console.log("mock ai gateway on", process.env.E2E_AI_PORT ?? 4300));
