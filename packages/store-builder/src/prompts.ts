import { FONTS, ICONS, type SiteDocument } from "./schema";
import { SECTION_DEFS } from "./sections";
import { THEME_PRESETS } from "./theme";
import { summarizeDocument } from "./summary";
import { linkTargets } from "./links";

/**
 * Prompts for the store builder. Data the model reads (the merchant's request, the current store) is fenced and
 * escaped so it cannot pose as instructions. The rules that keep a store honest live in RULES and are repeated in every
 * prompt: models follow rules they can see in the same turn far better than ones from earlier turns.
 */

export function fence(label: string, data: unknown): string {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  return `<${label}>\n${body.replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</${label}>`;
}

const RULES = `Honesty rules (never break these):
- Never invent reviews, ratings, customer counts, awards, press mentions, certifications, guarantees, delivery times, return windows or discounts. Use general wording ("Thoughtfully packed", "Questions? We're here to help") unless the merchant gave you the fact.
- Never write testimonials unless the merchant supplied the quotes. If you add a testimonials section without them, set "sample": true.
- Prices are the merchant's call: only set or change a price when asked, or when drafting new products (then use realistic prices for the category).
- Text is plain: no HTML, no Markdown links, no emojis in headings.
- Links inside the store are paths such as "/", "/shop", "/about", "/collections/all", "/collections/<slug>", "/products/<slug>", "/cart".`;

const STYLE = `Writing style: specific, sensory, confident and brief. Headings under 9 words. No filler ("Welcome to our store", "high-quality products"). Write like the brand's own copywriter.`;

/* ---------- full build: four small steps, each a JSON object ---------- */

export const BUILD_STEPS = [
  { key: "brief", label: "Understanding your brand" },
  { key: "catalog", label: "Drafting products and collections" },
  { key: "home", label: "Designing the home page" },
  { key: "pages", label: "Writing about, FAQ and contact pages" },
  { key: "images", label: "Creating images" },
  { key: "finish", label: "Final checks" },
] as const;
export type BuildStep = (typeof BUILD_STEPS)[number]["key"];

const fontList = Object.entries(FONTS).map(([k, f]) => `${k} (${f.label}, ${f.kind})`).join(", ");
const presetList = THEME_PRESETS.map((p) => `${p.key}: bg ${p.theme.palette.background}, text ${p.theme.palette.text}, primary ${p.theme.palette.primary}, accent ${p.theme.palette.accent}, ${p.theme.fonts.heading}/${p.theme.fonts.body}`).join("\n");

export function briefPrompt(request: string, currency: string) {
  return {
    system: `You are the creative director of an e-commerce studio. From a merchant's request, define the brand and visual identity of their online store.
${RULES}
${STYLE}

Respond with ONLY a JSON object:
{
  "brand": { "name": string (use the merchant's name if given; otherwise invent a short, memorable one), "tagline": string (<= 12 words) },
  "summary": string (one sentence: what the store sells, to whom),
  "voice": string (3-5 adjectives),
  "theme": {
    "palette": { "background", "surface", "text", "muted", "primary", "primaryText", "accent", "border" } (all "#rrggbb"; text must be very readable on background; primaryText readable on primary; surface is a subtle variation of background),
    "fonts": { "heading": key, "body": key },
    "radius": "none"|"sm"|"md"|"lg"|"xl", "buttonShape": "square"|"rounded"|"pill",
    "headingCase": "normal"|"uppercase", "headingWeight": "400"|"500"|"600"|"700"|"800",
    "spacing": "compact"|"comfortable"|"airy", "productImageRatio": "square"|"portrait"|"landscape"
  },
  "categories": [2-4 short collection names],
  "imageStyle": string (art direction applied to every photo: lighting, setting, palette, mood; no text or logos in images)
}
Font keys: ${fontList}.
Reference palettes (adapt, don't copy blindly):
${presetList}`,
    user: `${fence("merchant_request", request)}\nStore currency: ${currency}.`,
  };
}

export interface Brief {
  brand: { name: string; tagline: string };
  summary: string;
  voice: string;
  categories: string[];
  imageStyle: string;
}

export function catalogPrompt(brief: Brief, request: string, currency: string) {
  return {
    system: `You are a merchandiser writing the launch catalogue for an online store.
${RULES}
${STYLE}

Respond with ONLY a JSON object:
{
  "collections": [{ "id": short_snake_id, "title": string, "description": one sentence }] (one per category),
  "products": [{
    "id": short_snake_id, "title": string, "description": 2 short paragraphs separated by a blank line (materials, use, feel; no invented claims),
    "price": number in ${currency}, "compareAtPrice": null, "category": collection title, "collection": collection id,
    "tags": [1-4 words], "options": [{ "name": "Size", "values": ["S","M","L"] }] (only where it makes sense, else []),
    "featured": boolean (true for the 4 best products), "imagePrompt": what the product photo shows (subject only, 1 sentence)
  }] (8-12 products, spread across the collections)
}`,
    user: `${fence("brand_brief", brief)}\n${fence("merchant_request", request)}`,
  };
}

const sectionCatalog = () => Object.values(SECTION_DEFS).map((d) => `- ${d.type}: ${d.ai}`).join("\n");

export function homePrompt(brief: Brief, catalog: { collections: { id: string; title: string; slug: string }[]; products: { id: string; title: string }[] }) {
  return {
    system: `You are a senior e-commerce designer laying out the home page of a store. Choose sections from this catalogue:
${sectionCatalog()}
Common section fields: "background": "default"|"surface"|"primary"|"accent"|"inverse" (alternate backgrounds for rhythm), "spacing": "sm"|"md"|"lg".
Icons: ${ICONS.join(", ")}.
${RULES}
${STYLE}

Layout guidance: start with a hero; follow with featured_products; include collection_list when there are 2+ collections; tell the brand story with image_with_text; add features (3-4 benefits phrased without invented facts); end with newsletter. 6-8 sections. Every image needs "alt" and a "prompt" describing the photo (subject + composition).
Respond with ONLY a JSON object: { "sections": [ { "type": ..., ...fields } ] }`,
    user: `${fence("brand_brief", brief)}\n${fence("catalog", catalog)}`,
  };
}

export function pagesPrompt(brief: Brief) {
  return {
    system: `You are writing the supporting pages of an online store.
${RULES}
${STYLE}

Respond with ONLY a JSON object:
{
  "about": { "sections": [image_with_text (the founding story; image {alt, prompt}), rich_text (values, 2-3 short paragraphs), features (3 benefits)] },
  "faq": { "sections": [faq with 5-7 questions shoppers ask in this category; answers general where you don't know the merchant's policy (e.g. "Shipping times are shown at checkout")] },
  "contact": { "sections": [contact { heading, body, showForm: true }] },
  "announcement": { "enabled": true, "text": short line with no invented offer (e.g. a brand line or "New collection now in") },
  "footerNote": one short brand line,
  "seo": { "title": <= 60 chars, "description": <= 155 chars }
}
Section fields follow this catalogue:
${sectionCatalog()}`,
    user: fence("brand_brief", brief),
  };
}

/* ---------- edit turns ---------- */

export const EDIT_SYSTEM = () => `You are the AI designer inside a store builder. The merchant chats with you to change their online store. You change the store ONLY by emitting operations on its JSON document.

Operations (JSON objects):
- {"op":"set_brand","brand":{"name"?,"tagline"?}}
- {"op":"set_theme","theme":{"palette"?:{...partial colours "#rrggbb"},"fonts"?:{"heading"?,"body"?},"radius"?,"buttonShape"?,"headingCase"?,"headingWeight"?,"spacing"?,"productImageRatio"?}}
- {"op":"set_settings","settings":{"contactEmail"?,"announcement"?:{"enabled","text","href"?},"social"?:{"instagram"?:url,...},"seo"?:{"title","description"},"shipping"?:{"flatRate","freeOver"}}}
- {"op":"set_navigation","navigation":{"header"?:[{"label","href"}],"footer"?:[{"title","links":[{"label","href"}]}],"footerNote"?}}
- {"op":"add_page","page":{"slug","title","sections":[...]}}  /  {"op":"update_page","page":pageId,"props":{"title"?,"slug"?,"seo"?}}  /  {"op":"remove_page","page":pageId}
- {"op":"add_section","page":pageId,"after"?:sectionId|"start","section":{"type",...fields}}
- {"op":"update_section","section":sectionId,"props":{...only the fields to change; null removes an optional field}}
- {"op":"replace_section","section":sectionId,"with":{"type",...all fields}}
- {"op":"remove_section","section":sectionId}  /  {"op":"move_section","section":sectionId,"to":index}
- {"op":"add_product","product":{"title","description","price","category"?,"collection"?:collectionId,"tags"?,"options"?,"featured"?,"available"?,"images"?:[{"alt","prompt"}]}}
- {"op":"update_product","product":productId,"props":{...}}  /  {"op":"remove_product","product":productId}
- {"op":"add_collection","collection":{"title","description","productIds":[...]}}  /  {"op":"update_collection","collection":id,"props":{...}}  /  {"op":"remove_collection","collection":id}

Section catalogue:
${sectionCatalog()}
Common section fields: "hidden", "background": "default"|"surface"|"primary"|"accent"|"inverse", "spacing": "sm"|"md"|"lg".
Icons: ${ICONS.join(", ")}. Fonts: ${fontList}.
New images: give {"src":"","alt":...,"prompt":...}; images are generated after your turn. Keep existing "src" values unless asked to change the image.

${RULES}
${STYLE}

How to work:
- Make exactly the change asked for, with the fewest operations. Use the ids shown in the store document. Do not rebuild sections that only need a field changed.
- If the merchant selected a section, "this", "here" and "it" mean that section.
- Broad requests ("make it more premium", "redo the home page") are fine: change theme, copy and sections together.
- If the request is a question, or needs facts you don't have (their real prices, policies, quotes), answer or ask in the message and return no operations.

Reply in exactly this format:
<message>1-3 short sentences to the merchant about what you changed (or your answer/question). Plain text.</message>
<ops>[ ...operations... ]</ops>
<suggestions>["2-3 short follow-up requests the merchant might want next"]</suggestions>`;

export interface ChatTurn { role: "user" | "assistant"; content: string }

export function editPrompt(doc: SiteDocument, request: string, opts: { history?: ChatTurn[]; selection?: { pageId: string; section: unknown } | null; currentPath?: string } = {}) {
  const parts = [
    fence("store_document", summarizeDocument(doc)),
    fence("link_targets", linkTargets(doc).slice(0, 60).map((t) => t.href)),
  ];
  if (opts.currentPath) parts.push(`The merchant is looking at ${opts.currentPath}.`);
  if (opts.selection) parts.push(fence("selected_section", opts.selection));
  if (opts.history?.length) parts.push(fence("recent_conversation", opts.history.slice(-6).map((t) => `${t.role}: ${t.content.slice(0, 400)}`).join("\n")));
  parts.push(fence("merchant_request", request));
  return { system: EDIT_SYSTEM(), user: parts.join("\n") };
}

/** The art direction sent to the image model. Never includes text from shoppers. */
export function imagePrompt(subject: string, style: string): string {
  return `${subject.trim()}. ${style.trim()} Professional e-commerce photography, high detail, no text, no logos, no watermark.`.slice(0, 900);
}
