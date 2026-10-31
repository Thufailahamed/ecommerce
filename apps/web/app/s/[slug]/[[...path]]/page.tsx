import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { imageUrl, resolveRoute, type SiteDocument } from "@convertflow/store-builder";
import { Storefront } from "@/components/storefront/storefront";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const ASSET_BASE = `${API}/api/v1/storefront/assets`;

interface Published { slug: string; versionId: string; publishedAt: string; payments: boolean; document: SiteDocument }
interface Props {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** One fetch per request, shared by generateMetadata and the page. */
const loadStore = cache(async (slug: string): Promise<Published | null> => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const res = await fetch(`${API}/api/v1/storefront/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storefront ${slug}: ${res.status}`);
  return ((await res.json()) as { data: Published }).data;
});

const storePath = (path: string[] | undefined) => "/" + (path ?? []).join("/");

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, path } = await params;
  const store = await loadStore(slug);
  if (!store) return { title: { absolute: "Store not found" }, robots: { index: false } };
  const doc = store.document;
  const brand = doc.brand.name;
  const route = resolveRoute(doc, storePath(path));

  let title = doc.settings.seo.title || (doc.brand.tagline ? `${brand} · ${doc.brand.tagline}` : brand);
  let description = doc.settings.seo.description || doc.brand.tagline || undefined;
  let image = "";
  switch (route.kind) {
    case "page": {
      const isHome = route.page.slug === "";
      if (route.page.seo.title) title = route.page.seo.title;
      else if (!isHome) title = `${route.page.title} · ${brand}`;
      if (route.page.seo.description) description = route.page.seo.description;
      const hero = route.page.sections.find((s) => s.type === "hero" && !s.hidden);
      if (hero?.type === "hero") image = hero.image?.src ?? "";
      break;
    }
    case "product":
      title = `${route.product.title} · ${brand}`;
      description = route.product.description.replace(/\s+/g, " ").slice(0, 160) || description;
      image = route.product.images[0]?.src ?? "";
      break;
    case "collection":
      title = `${route.collection?.title ?? "All products"} · ${brand}`;
      if (route.collection?.description) description = route.collection.description.slice(0, 160);
      image = route.collection?.image?.src ?? "";
      break;
    case "cart": title = `Cart · ${brand}`; break;
    case "checkout": title = `Checkout · ${brand}`; break;
    case "order": title = `Order confirmation · ${brand}`; break;
    default: title = `Page not found · ${brand}`;
  }

  const imageAbs = await absoluteImage(imageUrl(image, ASSET_BASE));
  const privatePage = route.kind === "cart" || route.kind === "checkout" || route.kind === "order" || route.kind === "not_found";
  return {
    title: { absolute: title },
    ...(description ? { description } : {}),
    openGraph: { title, siteName: brand, ...(description ? { description } : {}), ...(imageAbs ? { images: [imageAbs] } : {}) },
    ...(privatePage ? { robots: { index: false } } : {}),
  };
}

/** Open Graph needs absolute URLs; bundled photos ("/photos/x.jpg") are served from this app's own origin. */
async function absoluteImage(url: string): Promise<string> {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${url}`;
}

export default async function StorePage({ params, searchParams }: Props) {
  const [{ slug, path }, query] = await Promise.all([params, searchParams]);
  const store = await loadStore(slug);
  if (!store) notFound();
  const sp = Object.fromEntries(Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string"));
  return (
    <Storefront
      mode="live"
      doc={store.document}
      path={storePath(path)}
      basePath={`/s/${slug}`}
      slug={slug}
      apiUrl={API}
      assetBase={ASSET_BASE}
      payments={store.payments}
      searchParams={sp}
    />
  );
}
