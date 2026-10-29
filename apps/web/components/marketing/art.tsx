import type { ReactNode } from "react";
import { Bell, Check, Mail, ShoppingBag, Sparkles, Star, Truck, X } from "lucide-react";

/* ---------- Product illustrations: original flat SVG art used as "store photos" across the page ---------- */

type Drawn = "sneaker" | "serum" | "chair" | "jar" | "headphones" | "backpack" | "candle" | "watch" | "tee" | "bowl" | "lipstick" | "bottle";

/**
 * Free photos from Unsplash (Unsplash License: free for commercial use, no attribution required), keyed to their
 * Unsplash photo id. Copies live in public/photos at two sizes: <key>.jpg (1000px wide) and <key>-sm.jpg (320px).
 * Product shots are unbranded; lifestyle shots show shoppers and use cases.
 */
export const PHOTOS = {
  "p-sneaker": "1525966222134-fcfa99b8ae77", "p-sneaker-white": "1608231387042-66d1773070a5", "p-serum": "1576426863848-c21f53c60b19",
  "p-serum-apply": "1670201203208-055d6d79db4a", "p-cream": "1609097164502-59a1f0f9a66f", "p-chair": "1589135003135-2a30f21cd08c",
  "p-chair-blue": "1578894622188-098059daa59e", "p-headphones": "1505740420928-5e560c06d30e", "p-headphones-pink": "1613040809024-b4ef7ba99bc3",
  "p-dog": "1543466835-00a7907e9de1", "p-dog-beach": "1530281700549-e82e7bf110d6", "p-fashion": "1650559117747-6dd115383cb7",
  "p-fashion-blue": "1685464670063-2cbac395fc24", "p-capsules": "1664956618021-73c47736845e", "p-jar": "1763747958224-7726941b0b15",
  "p-hikers": "1551632811-561732d1e306", "p-backpack": "1509762774605-f07235a08f1f", "p-shopper": "1758524944006-ba8116008496",
  "p-shopper-laptop": "1605629921852-f9b3d997c14a", "p-watch": "1523275335684-37898b6baf30", "p-watch-brown": "1557531365-e8b22d93dbd0",
} as const;
export type PhotoKey = keyof typeof PHOTOS;
export type Product = Drawn | PhotoKey;
const isPhoto = (p: Product): p is PhotoKey => p in PHOTOS;
/** Served from this site; slots up to 320px wide get the small copy. */
export const photoUrl = (k: PhotoKey, w = 800) => `/photos/${k}${w <= 320 ? "-sm" : ""}.jpg`;

/** A photo that fills its box. Lazy by default; pass eager for above-the-fold images. */
export function Photo({ k, w = 800, className = "", alt = "", eager }: { k: PhotoKey; w?: number; className?: string; alt?: string; eager?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element -- pre-sized static files in public/photos
  return <img src={photoUrl(k, w)} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" className={`object-cover ${className}`} />;
}

/** Background tone per product, so a grid of them reads like a styled catalog shoot. */
const TONE: Record<Drawn, [string, string]> = {
  sneaker: ["#e8edff", "#c9d5ff"], serum: ["#fdeee6", "#f6d3c2"], chair: ["#eef1ea", "#d6ddcc"], jar: ["#eaf6f0", "#c9e8d8"],
  headphones: ["#eceef3", "#cdd2de"], backpack: ["#f3ede4", "#e2d3bd"], candle: ["#f7efe6", "#ebd8c2"], watch: ["#e9edf5", "#c8d1e3"],
  tee: ["#e7eefc", "#c6d6f6"], bowl: ["#fbf0e1", "#f1d9b6"], lipstick: ["#fbe9ee", "#f3c6d3"], bottle: ["#e5f2f7", "#c3e1ec"],
};

function Body({ p }: { p: Drawn }) {
  switch (p) {
    case "sneaker": return (
      <g>
        <path d="M34 124c0-22 13-37 30-43l26-9c8 19 25 26 46 28 22 2 40 8 42 24z" fill="#2350ff" />
        <path d="M64 81l10-21c6-5 14-5 18 2l-2 10z" fill="#1636b8" />
        <path d="M30 124h152v6c0 8-6 13-14 13H44c-8 0-14-5-14-12z" fill="#fff" />
        <path d="M30 132h152" stroke="#d9def0" strokeWidth="3" />
        <path d="M58 114c30-14 62-14 98-4" stroke="#fff" strokeWidth="6" strokeLinecap="round" fill="none" />
        {[0, 1, 2, 3].map((i) => <path key={i} d={`M${76 + i * 9} ${84 + i * 3}l10 6`} stroke="#fff" strokeWidth="3" strokeLinecap="round" />)}
        <path d="M150 104c12 2 22 7 28 18" stroke="#1636b8" strokeWidth="5" fill="none" strokeLinecap="round" />
      </g>
    );
    case "serum": return (
      <g>
        <ellipse cx="100" cy="46" rx="11" ry="15" fill="#2b2b33" />
        <rect x="90" y="58" width="20" height="16" rx="3" fill="#c9a27c" />
        <rect x="74" y="72" width="52" height="88" rx="12" fill="#e8a27a" opacity=".92" />
        <rect x="80" y="100" width="40" height="40" rx="4" fill="#fff8f3" />
        <rect x="86" y="110" width="28" height="4" rx="2" fill="#2b2b33" />
        <rect x="90" y="120" width="20" height="3" rx="1.5" fill="#c9a27c" />
        <rect x="80" y="78" width="6" height="70" rx="3" fill="#fff" opacity=".35" />
      </g>
    );
    case "chair": return (
      <g>
        <rect x="52" y="54" width="96" height="66" rx="22" fill="#7e9a6a" />
        <rect x="44" y="108" width="112" height="30" rx="12" fill="#93ae7e" />
        <rect x="32" y="88" width="24" height="54" rx="11" fill="#6c8759" />
        <rect x="144" y="88" width="24" height="54" rx="11" fill="#6c8759" />
        <path d="M52 142l-6 20M148 142l6 20M80 142l-2 16M120 142l2 16" stroke="#4a3b2a" strokeWidth="5" strokeLinecap="round" />
      </g>
    );
    case "jar": return (
      <g>
        <rect x="66" y="56" width="68" height="22" rx="6" fill="#1d6b4c" />
        {[0, 1, 2, 3, 4, 5].map((i) => <rect key={i} x={70 + i * 11} y="58" width="3" height="18" rx="1.5" fill="#0f4a33" />)}
        <rect x="60" y="74" width="80" height="88" rx="16" fill="#fff" />
        <rect x="60" y="98" width="80" height="40" fill="#2aa673" />
        <circle cx="80" cy="118" r="9" fill="#fff" opacity=".9" />
        <rect x="94" y="110" width="34" height="5" rx="2.5" fill="#fff" />
        <rect x="94" y="120" width="22" height="4" rx="2" fill="#d4f3e4" />
      </g>
    );
    case "headphones": return (
      <g>
        <path d="M54 116V98c0-28 20-50 46-50s46 22 46 50v18" stroke="#1f2330" strokeWidth="12" fill="none" strokeLinecap="round" />
        <rect x="40" y="104" width="30" height="50" rx="13" fill="#2350ff" />
        <rect x="130" y="104" width="30" height="50" rx="13" fill="#2350ff" />
        <rect x="46" y="112" width="8" height="34" rx="4" fill="#5b82ff" />
        <rect x="146" y="112" width="8" height="34" rx="4" fill="#5b82ff" />
      </g>
    );
    case "backpack": return (
      <g>
        <path d="M86 52c0-10 28-10 28 0v8H86z" fill="none" stroke="#5a4630" strokeWidth="6" />
        <rect x="58" y="58" width="84" height="104" rx="28" fill="#c88a4a" />
        <rect x="70" y="112" width="60" height="40" rx="12" fill="#a86f36" />
        <rect x="70" y="112" width="60" height="8" rx="4" fill="#8e5b2a" />
        <rect x="96" y="124" width="8" height="10" rx="2" fill="#e8c9a0" />
        <path d="M72 68c10-6 46-6 56 0" stroke="#e8c9a0" strokeWidth="3" fill="none" />
      </g>
    );
    case "candle": return (
      <g>
        <path d="M100 52c-8 10-8 18 0 22 8-4 8-12 0-22z" fill="#ffb347" />
        <rect x="98" y="72" width="4" height="10" fill="#3a2d22" />
        <rect x="62" y="80" width="76" height="82" rx="12" fill="#f4e3cc" stroke="#d9bf9c" strokeWidth="3" />
        <rect x="62" y="80" width="76" height="14" rx="7" fill="#fff6ea" />
        <rect x="74" y="114" width="52" height="26" rx="4" fill="#3a2d22" />
        <rect x="82" y="122" width="36" height="4" rx="2" fill="#f4e3cc" />
      </g>
    );
    case "watch": return (
      <g>
        <rect x="84" y="30" width="32" height="44" rx="8" fill="#22324f" />
        <rect x="84" y="126" width="32" height="44" rx="8" fill="#22324f" />
        <circle cx="100" cy="100" r="34" fill="#dfe5f2" stroke="#8d99b3" strokeWidth="6" />
        <circle cx="100" cy="100" r="24" fill="#fff" />
        <path d="M100 100V84M100 100l11 7" stroke="#2350ff" strokeWidth="4" strokeLinecap="round" />
      </g>
    );
    case "tee": return (
      <g>
        <path d="M74 52l-34 18 12 26 16-7v70h64V89l16 7 12-26-34-18c-4 10-14 16-26 16s-22-6-26-16z" fill="#2350ff" />
        <path d="M74 52c4 10 14 16 26 16s22-6 26-16" stroke="#1636b8" strokeWidth="4" fill="none" />
        <rect x="88" y="104" width="24" height="24" rx="12" fill="#fff" opacity=".9" />
      </g>
    );
    case "bowl": return (
      <g>
        <path d="M44 112h112c-4 30-26 46-56 46s-52-16-56-46z" fill="#e26d3d" />
        <ellipse cx="100" cy="112" rx="56" ry="12" fill="#c4542a" />
        <ellipse cx="100" cy="110" rx="46" ry="8" fill="#8a4b24" />
        <g transform="rotate(-18 100 70)"><rect x="76" y="64" width="48" height="12" rx="6" fill="#fff" />{[[76, 62], [76, 78], [124, 62], [124, 78]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="8" fill="#fff" />)}</g>
      </g>
    );
    case "lipstick": return (
      <g>
        <path d="M88 56l24-8v40H88z" fill="#c2244f" />
        <rect x="84" y="86" width="32" height="20" rx="3" fill="#e2c178" />
        <rect x="80" y="104" width="40" height="58" rx="6" fill="#1f1a24" />
        <rect x="86" y="110" width="4" height="46" rx="2" fill="#fff" opacity=".2" />
      </g>
    );
    case "bottle": return (
      <g>
        <rect x="88" y="40" width="24" height="18" rx="5" fill="#1f2330" />
        <path d="M86 58h28v12c14 6 20 16 20 30v54c0 6-4 10-10 10H76c-6 0-10-4-10-10v-54c0-14 6-24 20-30z" fill="#3aa0c8" />
        <rect x="72" y="104" width="56" height="34" rx="4" fill="#fff" />
        <rect x="80" y="114" width="40" height="5" rx="2.5" fill="#1f2330" />
        <rect x="80" y="124" width="26" height="4" rx="2" fill="#3aa0c8" />
      </g>
    );
  }
}

/** A square "product photo": soft tone background, floor shadow and the product itself. */
export function ProductArt({ p, className = "" }: { p: Product; className?: string }) {
  if (isPhoto(p)) return <Photo k={p} w={500} className={className} />;
  const [a, b] = TONE[p];
  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label={`Illustration of a ${p}`}>
      <defs><linearGradient id={`pa-${p}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient></defs>
      <rect width="200" height="200" fill={`url(#pa-${p})`} />
      <ellipse cx="100" cy="168" rx="64" ry="8" fill="#0a0c14" opacity=".1" />
      <Body p={p} />
    </svg>
  );
}

/* ---------- Example stores: one photo set per vertical, shared by every mock on the page ---------- */

export const STORES = {
  "Northpeak": { hero: "p-hikers", products: ["p-backpack", "p-sneaker", "p-watch-brown", "p-sneaker-white", "p-hikers", "p-backpack", "p-dog-beach", "p-watch"] },
  "Lumen Skin": { hero: "p-serum-apply", products: ["p-serum", "p-cream", "p-serum-apply", "p-capsules", "p-cream", "p-serum", "p-jar", "p-serum-apply"] },
  "Field & Thread": { hero: "p-fashion", products: ["p-fashion-blue", "p-sneaker", "p-watch", "p-sneaker-white", "p-fashion", "p-watch-brown", "p-backpack", "p-fashion-blue"] },
  "Hearth Home": { hero: "p-chair-blue", products: ["p-chair", "p-chair-blue", "p-cream", "p-watch-brown", "p-chair-blue", "p-chair", "p-shopper-laptop", "p-serum"] },
  "Daily Form": { hero: "p-capsules", products: ["p-jar", "p-capsules", "p-serum", "p-cream", "p-capsules", "p-jar", "p-cream", "p-serum"] },
  "Good Boy Co.": { hero: "p-dog-beach", products: ["p-dog", "p-dog-beach", "p-hikers", "p-backpack", "p-dog", "p-dog-beach", "p-sneaker", "p-watch-brown"] },
  "Signal Audio": { hero: "p-headphones", products: ["p-headphones", "p-headphones-pink", "p-watch", "p-watch-brown", "p-headphones-pink", "p-headphones", "p-shopper-laptop", "p-watch"] },
} satisfies Record<string, { hero: PhotoKey; products: PhotoKey[] }>;
export type StoreName = keyof typeof STORES;

/* ---------- Storefront mock: header, hero banner and a product grid ---------- */

export function StoreMock({ name, hero, products, tagline = "New season", accent = "#0a0c14", cols = 4, children, compact }: {
  name: string; hero: Product; products: Product[]; tagline?: string; accent?: string; cols?: 2 | 3 | 4; children?: ReactNode; compact?: boolean;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-white text-[#0a0c14]">
      <div className={`flex items-center justify-between border-b border-black/5 ${compact ? "px-3 py-2" : "px-5 py-3"}`}>
        <span className={`font-display font-bold uppercase tracking-tight ${compact ? "text-[9px]" : "text-[12px]"}`} style={{ color: accent }}>{name}</span>
        <span className={`hidden gap-4 text-black/60 sm:flex ${compact ? "text-[7px]" : "text-[10px]"}`}><span>Shop</span><span>New</span><span>Journal</span></span>
        <ShoppingBag className={compact ? "size-2.5" : "size-3.5"} />
      </div>
      <div className={`grid grid-cols-[1.2fr_1fr] items-center gap-3 bg-[#f5f6fa] ${compact ? "px-3 py-2" : "px-5 py-4"}`}>
        <div>
          <p className={`font-semibold uppercase tracking-wider text-black/60 ${compact ? "text-[6px]" : "text-[9px]"}`}>{tagline}</p>
          <p className={`mt-1 font-display font-bold uppercase leading-tight ${compact ? "text-[10px]" : "text-[17px]"}`}>Made for<br />every day</p>
          <span className={`mt-2 inline-block rounded-full font-semibold text-white ${compact ? "px-2 py-0.5 text-[6px]" : "px-3 py-1 text-[9px]"}`} style={{ background: accent }}>Shop now</span>
        </div>
        <ProductArt p={hero} className={`w-full rounded-lg ${compact ? "h-16" : "h-28"}`} />
      </div>
      <div className={`grid gap-2 ${compact ? "p-3" : "p-5"}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {products.slice(0, cols * 2).map((p, i) => (
          <div key={i}>
            <ProductArt p={p} className="aspect-square w-full rounded-md" />
            <div className={`mt-1 rounded bg-black/15 ${compact ? "h-1 w-3/4" : "h-1.5 w-3/4"}`} />
            <div className={`mt-1 rounded bg-black/10 ${compact ? "h-1 w-1/3" : "h-1.5 w-1/3"}`} />
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}

/* ---------- Campaign overlays (what the storefront script renders), drawn for illustration ---------- */

export function PopupMock({ title, body, cta, product, email, compact }: { title: string; body: string; cta: string; product?: Product; email?: boolean; compact?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#0a0c14]/45 p-3 backdrop-blur-[1px]">
      <div className={`pop-in relative grid w-full overflow-hidden rounded-xl bg-white text-[#0a0c14] shadow-2xl ${product ? "max-w-[78%] grid-cols-[0.9fr_1fr]" : "max-w-[58%]"}`}>
        <X className="absolute right-2 top-2 size-3 text-black/40" />
        {product && <ProductArt p={product} className="h-full w-full object-cover" />}
        <div className={compact ? "p-2.5" : "p-4"}>
          <p className={`font-display font-bold uppercase leading-tight ${compact ? "text-[9px]" : "text-[15px]"}`}>{title}</p>
          <p className={`mt-1 leading-snug text-black/60 ${compact ? "text-[6.5px]" : "text-[10.5px]"}`}>{body}</p>
          {email && <div className={`mt-2 rounded-md border border-black/15 text-black/60 ${compact ? "px-1.5 py-0.5 text-[6px]" : "px-2.5 py-1.5 text-[10px]"}`}>you@email.com</div>}
          <span className={`mt-2 block rounded-full bg-[#2350ff] text-center font-semibold text-white ${compact ? "py-0.5 text-[6.5px]" : "py-1.5 text-[10.5px]"}`}>{cta}</span>
        </div>
      </div>
    </div>
  );
}

export function SlideInMock({ title, cta, product, compact }: { title: string; cta: string; product: Product; compact?: boolean }) {
  return (
    <div className={`slide-in-r absolute bottom-3 right-3 flex items-center gap-2 rounded-xl bg-white text-[#0a0c14] shadow-2xl ring-1 ring-black/5 ${compact ? "w-[46%] p-1.5" : "w-[42%] p-2.5"}`}>
      <ProductArt p={product} className={`shrink-0 rounded-lg ${compact ? "size-8" : "size-14"}`} />
      <div className="min-w-0">
        <p className={`font-bold leading-tight ${compact ? "text-[7px]" : "text-[11px]"}`}>{title}</p>
        <span className={`mt-1 inline-block rounded-full bg-[#2350ff] font-semibold text-white ${compact ? "px-1.5 py-0.5 text-[6px]" : "px-2.5 py-1 text-[9.5px]"}`}>{cta}</span>
      </div>
    </div>
  );
}

export function BarMock({ text, cta, compact }: { text: string; cta?: string; compact?: boolean }) {
  return (
    <div className={`slide-down absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-2 bg-[#2350ff] font-semibold text-white ${compact ? "py-1 text-[6.5px]" : "py-1.5 text-[10px]"}`}>
      <Truck className={compact ? "size-2" : "size-3"} />{text}{cta && <span className="rounded-full bg-white px-2 py-0.5 text-[#2350ff]">{cta}</span>}
    </div>
  );
}

export function ToastMock({ text, sub, compact }: { text: string; sub: string; compact?: boolean }) {
  return (
    <div className={`pop-in absolute bottom-3 left-3 flex items-center gap-2 rounded-xl bg-[#0a0c14] text-white shadow-2xl ${compact ? "w-[48%] p-1.5" : "w-[40%] p-2.5"}`}>
      <span className={`grid shrink-0 place-items-center rounded-lg bg-[#2350ff] ${compact ? "size-5" : "size-8"}`}><Sparkles className={compact ? "size-2.5" : "size-3.5"} /></span>
      <div className="min-w-0"><p className={`font-semibold leading-tight ${compact ? "text-[7px]" : "text-[11px]"}`}>{text}</p><p className={`text-white/60 ${compact ? "text-[6px]" : "text-[9.5px]"}`}>{sub}</p></div>
    </div>
  );
}

export function UpsellMock({ items, compact }: { items: Product[]; compact?: boolean }) {
  return (
    <div className={`slide-in-r absolute inset-y-0 right-0 flex w-[44%] flex-col bg-white text-[#0a0c14] shadow-[-20px_0_40px_-20px_rgba(0,0,0,.35)] ${compact ? "p-2" : "p-4"}`}>
      <p className={`font-display font-bold uppercase ${compact ? "text-[8px]" : "text-[13px]"}`}>Your cart</p>
      <div className={`mt-2 rounded-lg bg-[#eef2ff] font-semibold text-[#2350ff] ${compact ? "p-1 text-[6px]" : "p-2 text-[9.5px]"}`}>You are $12 away from free shipping</div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/10"><div className="h-full w-3/4 rounded-full bg-[#2350ff]" /></div>
      <p className={`mt-3 font-semibold text-black/50 ${compact ? "text-[6.5px]" : "text-[10px]"}`}>Complete the look</p>
      <div className="mt-1.5 space-y-1.5">
        {items.map((p) => (
          <div key={p} className="flex items-center gap-2">
            <ProductArt p={p} className={`shrink-0 rounded-md ${compact ? "size-6" : "size-10"}`} />
            <div className="flex-1"><div className="h-1.5 w-3/4 rounded bg-black/15" /><div className="mt-1 h-1.5 w-1/3 rounded bg-black/10" /></div>
            <span className={`rounded-full bg-[#2350ff] font-semibold text-white ${compact ? "px-1 text-[6px]" : "px-2 py-0.5 text-[9px]"}`}>Add</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeedMock({ compact }: { compact?: boolean }) {
  return (
    <div className={`pop-in absolute right-3 top-10 rounded-xl bg-white text-[#0a0c14] shadow-2xl ring-1 ring-black/5 ${compact ? "w-[46%] p-1.5" : "w-[40%] p-2.5"}`}>
      <p className={`flex items-center gap-1 font-bold ${compact ? "text-[7px]" : "text-[11px]"}`}><Bell className={compact ? "size-2" : "size-3"} />Updates<span className="ml-auto rounded-full bg-[#2350ff] px-1.5 text-[8px] text-white">3</span></p>
      {["New trail collection is live", "Free returns this month", "Restock: Ridge runner"].map((t, i) => (
        <div key={t} className={`mt-1.5 flex items-center gap-1.5 rounded-lg ${i === 0 ? "bg-[#eef2ff]" : "bg-black/[0.03]"} ${compact ? "p-1 text-[6px]" : "p-1.5 text-[9.5px]"}`}><span className="size-1.5 shrink-0 rounded-full bg-[#2350ff]" />{t}</div>
      ))}
    </div>
  );
}

export function RestockMock({ product, compact }: { product: Product; compact?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#0a0c14]/45 p-3">
      <div className={`pop-in w-full max-w-[52%] rounded-xl bg-white text-center text-[#0a0c14] shadow-2xl ${compact ? "p-2" : "p-4"}`}>
        <ProductArt p={product} className={`mx-auto rounded-lg ${compact ? "size-10" : "size-16"}`} />
        <p className={`mt-1.5 font-display font-bold uppercase ${compact ? "text-[8px]" : "text-[13px]"}`}>Sold out, for now</p>
        <p className={`text-black/60 ${compact ? "text-[6px]" : "text-[10px]"}`}>Get one email when it is back.</p>
        <span className={`mt-2 flex items-center justify-center gap-1 rounded-full bg-[#2350ff] font-semibold text-white ${compact ? "py-0.5 text-[6.5px]" : "py-1.5 text-[10px]"}`}><Mail className={compact ? "size-2" : "size-3"} />Notify me</span>
      </div>
    </div>
  );
}

export function ReviewStars({ className = "" }: { className?: string }) {
  return <span className={`inline-flex ${className}`}>{[0, 1, 2, 3, 4].map((i) => <Star key={i} className="size-[1em] fill-current" />)}</span>;
}

export const Tick = ({ className = "" }: { className?: string }) => <span className={`grid size-5 shrink-0 place-items-center rounded-full bg-[#2350ff] text-white ${className}`}><Check className="size-3" strokeWidth={3} aria-hidden /></span>;
