import { SCHEMA_VERSION, SiteDocument, type Section, type SiteDocumentInput } from "./schema";
import { SECTION_DEFS, type NewSection } from "./sections";
import { presetTheme } from "./theme";

const sec = (id: string, s: NewSection): Section => ({ ...s, id } as Section);

/** A complete, valid store with the standard pages and no products. Used for blank starts and as the AI's scaffold. */
export function starterDocument(opts: { name: string; currency?: string; preset?: string; tagline?: string }): SiteDocument {
  const name = opts.name.trim() || "My store";
  const input: SiteDocumentInput = {
    schemaVersion: SCHEMA_VERSION,
    brand: { name, tagline: opts.tagline ?? "" },
    theme: presetTheme(opts.preset ?? "minimal"),
    settings: { currency: opts.currency ?? "USD" },
    navigation: {
      header: [{ label: "Shop", href: "/shop" }, { label: "About", href: "/about" }, { label: "FAQ", href: "/faq" }, { label: "Contact", href: "/contact" }],
      footer: [
        { title: "Shop", links: [{ label: "All products", href: "/collections/all" }] },
        { title: "Help", links: [{ label: "FAQ", href: "/faq" }, { label: "Contact", href: "/contact" }] },
      ],
      footerNote: "",
    },
    pages: [
      { id: "home", slug: "", title: "Home", sections: [
        sec("hero", { ...SECTION_DEFS.hero.create(), heading: name, subheading: opts.tagline || "Welcome to our store." } as NewSection),
        sec("featured", SECTION_DEFS.featured_products.create()),
        sec("newsletter", SECTION_DEFS.newsletter.create()),
      ] },
      shopPage(),
      { id: "about", slug: "about", title: "About", sections: [sec("about_story", { ...SECTION_DEFS.image_with_text.create(), heading: `About ${name}` } as NewSection)] },
      { id: "faq", slug: "faq", title: "FAQ", sections: [sec("faq_list", SECTION_DEFS.faq.create())] },
      { id: "contact", slug: "contact", title: "Contact", sections: [sec("contact_form", SECTION_DEFS.contact.create())] },
    ],
  };
  return SiteDocument.parse(input);
}

/** The catalogue page every generated store gets. Built deterministically: there is nothing for a model to add. */
export function shopPage() {
  return { id: "shop", slug: "shop", title: "Shop", sections: [sec("shop_grid", SECTION_DEFS.product_grid.create())] };
}
