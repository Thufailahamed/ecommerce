"use client";

import { useId, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, Clock, Mail, MapPin, Phone, Quote } from "lucide-react";
import {
  collectionPath, collectionProducts, productsForSection, sectionLabel,
  type Section, type SectionOf,
} from "@convertflow/store-builder";
import { postStore, useStore } from "./context";
import { ButtonLink, cx, ICON_MAP, paragraphs, Placeholder, ProductCard, ProductGridView, RichText, SectionHeader, SfImage, SfLink } from "./ui";

export interface EditHooks {
  selectedId: string | null | undefined;
  hoveredId: string | null | undefined;
  onSelect: ((sectionId: string, pageId: string) => void) | undefined;
  onHover: ((sectionId: string | null) => void) | undefined;
}

/** One section of a page with its background, spacing and, in the editor, its selection affordances. */
export function SectionView({ section, pageId, edit }: { section: Section; pageId: string; edit: EditHooks }) {
  const { mode } = useStore();
  if (section.hidden && mode !== "edit") return null;
  // Sample quotes are placeholders the merchant must replace; shoppers never see them.
  if (section.type === "testimonials" && section.sample && mode === "live") return null;
  const body = <SectionBody s={section} />;

  const editing = mode === "edit";
  const selected = editing && edit.selectedId === section.id;
  const onClickCapture = editing ? (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    edit.onSelect?.(section.id, pageId);
  } : undefined;

  return (
    <section
      id={section.id}
      data-section-id={section.id}
      className={cx(
        "sf-section", `sf-bg-${section.background}`, `sf-pad-${section.spacing}`, `sf-s-${section.type}`,
        editing && "sf-editable", selected && "is-selected", editing && edit.hoveredId === section.id && "is-hovered",
        section.hidden && "is-hidden",
      )}
      onClickCapture={onClickCapture}
      onMouseEnter={editing ? () => edit.onHover?.(section.id) : undefined}
      onMouseLeave={editing ? () => edit.onHover?.(null) : undefined}
    >
      {editing && (
        <span className="sf-edit-chip" aria-hidden="true">
          {sectionLabel(section)}
          {section.hidden && <span className="sf-edit-tag">Hidden</span>}
        </span>
      )}
      {body}
    </section>
  );
}

function SectionBody({ s }: { s: Section }): ReactNode {
  switch (s.type) {
    case "hero": return <Hero s={s} />;
    case "featured_products": return <FeaturedProducts s={s} />;
    case "collection_list": return <CollectionList s={s} />;
    case "image_with_text": return <ImageWithText s={s} />;
    case "rich_text": return <RichTextSection s={s} />;
    case "features": return <Features s={s} />;
    case "testimonials": return <Testimonials s={s} />;
    case "newsletter": return <Newsletter s={s} />;
    case "faq": return <Faq s={s} />;
    case "cta_banner": return <CtaBanner s={s} />;
    case "gallery": return <Gallery s={s} />;
    case "contact": return <Contact s={s} />;
    case "product_grid": return <ProductGrid s={s} />;
    case "logo_strip": return <LogoStrip s={s} />;
  }
}

/** Shown in the editor and draft preview where a live store would render nothing. */
function EditorHint({ children }: { children: ReactNode }) {
  const { mode } = useStore();
  if (mode === "live") return null;
  return <div className="sf-container"><div className="sf-hint">{children}</div></div>;
}

/* ---------- hero ---------- */

function Hero({ s }: { s: SectionOf<"hero"> }) {
  const layout = s.layout === "split" && !s.image ? "centered" : s.layout;
  const copy = (
    <div className="sf-hero-copy">
      {s.eyebrow && <p className="sf-eyebrow">{s.eyebrow}</p>}
      <h1 className="sf-display">{s.heading}</h1>
      {s.subheading && <p className="sf-lead sf-hero-sub">{s.subheading}</p>}
      {(s.primaryCta || s.secondaryCta) && (
        <div className={cx("sf-btn-row", layout !== "split" && "is-center")}>
          {s.primaryCta && <ButtonLink link={s.primaryCta} className="sf-btn-lg" />}
          {s.secondaryCta && <ButtonLink link={s.secondaryCta} variant="outline" className="sf-btn-lg" />}
        </div>
      )}
    </div>
  );
  const image = s.image ? <SfImage src={s.image.src} alt={s.image.alt} label={s.heading} eager className="sf-hero-img" /> : null;

  if (layout === "overlay") {
    return (
      <div className={cx("sf-hero sf-hero-overlay", `sf-h-${s.height}`)}>
        <div className="sf-hero-bg">{image ?? <Placeholder className="sf-hero-img" />}</div>
        <div className="sf-hero-scrim" />
        <div className="sf-container sf-hero-inner">{copy}</div>
      </div>
    );
  }
  if (layout === "split") {
    return (
      <div className={cx("sf-hero sf-hero-split", `sf-h-${s.height}`)}>
        <div className="sf-container sf-hero-grid">
          {copy}
          <div className="sf-hero-media">{image}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cx("sf-hero sf-hero-centered", `sf-h-${s.height}`, image && "has-image")}>
      <div className="sf-container sf-hero-inner">{copy}</div>
      {image && <div className="sf-container"><div className="sf-hero-wide">{image}</div></div>}
    </div>
  );
}

/* ---------- commerce ---------- */

function FeaturedProducts({ s }: { s: SectionOf<"featured_products"> }) {
  const { doc } = useStore();
  const products = productsForSection(doc, s);
  return (
    <div className="sf-container">
      <SectionHeader heading={s.heading} subheading={s.subheading} cta={s.cta} />
      {products.length ? (
        <ul className={cx("sf-products", `sf-cols-${s.columns}`)}>
          {products.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
        </ul>
      ) : <EditorHint>Add products to your catalogue and they will appear here.</EditorHint>}
    </div>
  );
}

function CollectionList({ s }: { s: SectionOf<"collection_list"> }) {
  const { doc } = useStore();
  const collections = s.collectionIds.length
    ? s.collectionIds.map((id) => doc.collections.find((c) => c.id === id)).filter((c) => c !== undefined)
    : doc.collections;
  return (
    <div className="sf-container">
      <SectionHeader heading={s.heading} subheading={s.subheading} />
      {collections.length === 0 ? <EditorHint>Create a collection to show it here.</EditorHint> : (
        <ul className={cx("sf-collections", s.layout === "tiles" ? "is-tiles" : "is-cards", collections.length < 3 && `has-${collections.length}`)}>
          {collections.map((c) => {
            const products = collectionProducts(doc, c.id);
            const img = c.image?.src ? c.image : products.find((p) => p.images[0]?.src)?.images[0];
            const media = <SfImage src={img?.src ?? ""} alt={c.image?.alt || ""} label={c.title} className="sf-coll-img" />;
            return (
              <li key={c.id}>
                <SfLink href={collectionPath(c)} className="sf-coll">
                  <div className="sf-coll-media">{media}</div>
                  <div className="sf-coll-body">
                    <h3 className="sf-h3">{c.title}</h3>
                    {s.layout === "grid" && c.description && <p className="sf-muted sf-clamp-2">{c.description}</p>}
                    <span className="sf-coll-cta">
                      {s.layout === "grid" ? `${products.length} ${products.length === 1 ? "product" : "products"}` : "Shop now"}
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                  </div>
                </SfLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProductGrid({ s }: { s: SectionOf<"product_grid"> }) {
  const { doc } = useStore();
  const products = collectionProducts(doc, s.collectionId ?? null);
  return (
    <div className="sf-container">
      <SectionHeader heading={s.heading} />
      <ProductGridView products={products} columns={s.columns} showFilters={s.showFilters} showSort={s.showSort} />
    </div>
  );
}

/* ---------- content ---------- */

function ImageWithText({ s }: { s: SectionOf<"image_with_text"> }) {
  return (
    <div className={cx("sf-container sf-iwt", s.imagePosition === "right" && "is-reversed", !s.image && "no-image")}>
      {s.image && <div className="sf-iwt-media"><SfImage src={s.image.src} alt={s.image.alt} label={s.heading} /></div>}
      <div className="sf-iwt-copy">
        {s.eyebrow && <p className="sf-eyebrow">{s.eyebrow}</p>}
        <h2 className="sf-h2">{s.heading}</h2>
        <RichText text={s.body} className="sf-muted-rich" />
        {s.cta && <div className="sf-btn-row"><ButtonLink link={s.cta} variant="outline" /></div>}
      </div>
    </div>
  );
}

function RichTextSection({ s }: { s: SectionOf<"rich_text"> }) {
  return (
    <div className={cx("sf-container sf-rt", s.width === "narrow" ? "is-narrow" : "is-wide", s.align === "center" && "is-center")}>
      {s.heading && <h2 className="sf-h2">{s.heading}</h2>}
      <RichText text={s.body} />
    </div>
  );
}

function Features({ s }: { s: SectionOf<"features"> }) {
  return (
    <div className="sf-container">
      <SectionHeader heading={s.heading} subheading={s.subheading} align="center" />
      <ul className={cx("sf-features", `sf-cols-${s.columns}`)}>
        {s.items.map((item, i) => {
          const Icon = ICON_MAP[item.icon];
          return (
            <li key={i} className="sf-feature">
              <span className="sf-feature-icon"><Icon size={22} strokeWidth={1.6} aria-hidden="true" /></span>
              <h3 className="sf-h4">{item.title}</h3>
              {item.body && <p className="sf-muted">{item.body}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Testimonials({ s }: { s: SectionOf<"testimonials"> }) {
  const { mode } = useStore();
  return (
    <div className="sf-container">
      {s.sample && mode !== "live" && <p className="sf-sample-badge">Sample quotes — replace with real ones before publishing</p>}
      <SectionHeader heading={s.heading} align="center" />
      <ul className={cx("sf-quotes", s.items.length === 1 && "is-single", s.items.length === 2 && "is-double")}>
        {s.items.map((q, i) => (
          <li key={i}>
            <figure className="sf-quote">
              <Quote className="sf-quote-mark" size={28} strokeWidth={1.25} aria-hidden="true" />
              <blockquote><p>{q.quote}</p></blockquote>
              <figcaption>
                <span className="sf-quote-avatar" aria-hidden="true">{q.author.charAt(0).toUpperCase()}</span>
                <span><strong>{q.author}</strong>{q.role && <span className="sf-muted">{q.role}</span>}</span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Faq({ s }: { s: SectionOf<"faq"> }) {
  return (
    <div className="sf-container sf-faq">
      {s.heading && <h2 className="sf-h2 sf-faq-title">{s.heading}</h2>}
      <div className="sf-faq-list">
        {s.items.map((item, i) => (
          <details key={i} className="sf-faq-item">
            <summary><span>{item.question}</span><span className="sf-faq-icon" aria-hidden="true" /></summary>
            <div className="sf-faq-answer">{paragraphs(item.answer).map((p, j) => <p key={j}>{p}</p>)}</div>
          </details>
        ))}
      </div>
    </div>
  );
}

function CtaBanner({ s }: { s: SectionOf<"cta_banner"> }) {
  const withImage = Boolean(s.image?.src);
  return (
    <div className="sf-container">
      <div className={cx("sf-cta", withImage && "has-image")}>
        {withImage && s.image && (
          <>
            <div className="sf-cta-bg"><SfImage src={s.image.src} alt={s.image.alt} /></div>
            <div className="sf-hero-scrim" />
          </>
        )}
        <div className="sf-cta-copy">
          <h2 className="sf-h2">{s.heading}</h2>
          {s.body && <p className="sf-lead">{s.body}</p>}
          <div className="sf-btn-row is-center"><ButtonLink link={s.cta} className="sf-btn-lg" /></div>
        </div>
      </div>
    </div>
  );
}

function Gallery({ s }: { s: SectionOf<"gallery"> }) {
  return (
    <div className="sf-container">
      <SectionHeader heading={s.heading} />
      <ul className={cx("sf-gallery-grid", `sf-cols-${s.columns}`)}>
        {s.images.map((img, i) => (
          <li key={i} className="sf-gallery-cell"><SfImage src={img.src} alt={img.alt} /></li>
        ))}
      </ul>
    </div>
  );
}

function LogoStrip({ s }: { s: SectionOf<"logo_strip"> }) {
  return (
    <div className="sf-container sf-logos">
      {s.heading && <p className="sf-eyebrow sf-logos-title">{s.heading}</p>}
      <ul className="sf-logo-row">{s.items.map((name, i) => <li key={i} className="sf-wordmark">{name}</li>)}</ul>
    </div>
  );
}

/* ---------- forms ---------- */

type FormState = { kind: "idle" } | { kind: "sending" } | { kind: "done"; message: string } | { kind: "error"; message: string };

function useStoreForm() {
  const ctx = useStore();
  const [state, setState] = useState<FormState>({ kind: "idle" });
  const send = async (body: Record<string, string>, success: string, previewNote?: string) => {
    if (state.kind === "sending") return;
    if (ctx.mode !== "live") { setState({ kind: "done", message: previewNote ? `${success} ${previewNote}` : success }); return; }
    setState({ kind: "sending" });
    const res = await postStore(ctx, "/forms", body);
    if (res.ok) setState({ kind: "done", message: success });
    else setState({ kind: "error", message: res.status === 429 ? "Too many attempts. Please try again in a minute." : res.status === 422 ? "Please check the details and try again." : res.message });
  };
  return { state, send };
}

function Newsletter({ s }: { s: SectionOf<"newsletter"> }) {
  const id = useId();
  const { state, send } = useStoreForm();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
    if (email) void send({ kind: "newsletter", email }, s.successMessage);
  };
  return (
    <div className="sf-container sf-newsletter">
      <h2 className="sf-h2">{s.heading}</h2>
      {s.body && <p className="sf-lead sf-muted">{s.body}</p>}
      {state.kind === "done" ? (
        <p className="sf-form-success" role="status">{state.message}</p>
      ) : (
        <form className="sf-inline-form" onSubmit={submit}>
          <label htmlFor={`${id}-email`} className="sf-sr">Email address</label>
          <input id={`${id}-email`} name="email" type="email" required autoComplete="email" inputMode="email" placeholder={s.placeholder || "Email address"} maxLength={254} />
          <button type="submit" className="sf-btn sf-btn-primary" disabled={state.kind === "sending"}>{state.kind === "sending" ? "…" : s.buttonLabel}</button>
        </form>
      )}
      {state.kind === "error" && <p className="sf-form-error" role="alert">{state.message}</p>}
    </div>
  );
}

function Contact({ s }: { s: SectionOf<"contact"> }) {
  const id = useId();
  const { state, send } = useStoreForm();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    void send({ kind: "contact", name: get("name"), email: get("email"), message: get("message") }, "Thanks — your message is on its way. We'll reply by email.", "(Messages are delivered from your published store.)");
  };
  const details = [
    s.email && { icon: Mail, label: "Email", node: <a href={`mailto:${s.email}`}>{s.email}</a> },
    s.phone && { icon: Phone, label: "Phone", node: <a href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}>{s.phone}</a> },
    s.address && { icon: MapPin, label: "Visit", node: <span className="sf-pre">{s.address}</span> },
    s.hours && { icon: Clock, label: "Hours", node: <span className="sf-pre">{s.hours}</span> },
  ].filter((d) => !!d);
  return (
    <div className={cx("sf-container sf-contact", !s.showForm && "no-form")}>
      <div className="sf-contact-info">
        <h2 className="sf-h2">{s.heading}</h2>
        {s.body && <p className="sf-lead sf-muted">{s.body}</p>}
        {details.length > 0 && (
          <dl className="sf-contact-list">
            {details.map((d) => (
              <div key={d.label}>
                <dt><d.icon size={18} strokeWidth={1.6} aria-hidden="true" />{d.label}</dt>
                <dd>{d.node}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {s.showForm && (
        <div className="sf-contact-card">
          {state.kind === "done" ? <p className="sf-form-success" role="status">{state.message}</p> : (
            <form className="sf-fields" onSubmit={submit}>
              <div className="sf-field is-half"><label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} name="name" required autoComplete="name" maxLength={120} /></div>
              <div className="sf-field is-half"><label htmlFor={`${id}-email`}>Email</label><input id={`${id}-email`} name="email" type="email" required autoComplete="email" maxLength={254} /></div>
              <div className="sf-field"><label htmlFor={`${id}-message`}>Message</label><textarea id={`${id}-message`} name="message" required rows={5} maxLength={4000} /></div>
              {state.kind === "error" && <p className="sf-form-error" role="alert">{state.message}</p>}
              <div className="sf-field"><button type="submit" className="sf-btn sf-btn-primary" disabled={state.kind === "sending"}>{state.kind === "sending" ? "Sending…" : "Send message"}</button></div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
