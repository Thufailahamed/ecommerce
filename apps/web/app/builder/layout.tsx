import type { Metadata } from "next";
import { SessionProvider } from "@/lib/session";
import { storefrontFontClass } from "@/components/storefront/fonts";

export const metadata: Metadata = { title: "Store builder", robots: { index: false, follow: false } };

/** Full-screen workspace: no dashboard sidebar. The storefront fonts are loaded so the theme pickers can preview them. */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return <div className={storefrontFontClass}><SessionProvider>{children}</SessionProvider></div>;
}
