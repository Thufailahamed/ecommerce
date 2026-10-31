import type { Metadata } from "next";
import "@/components/storefront/storefront.css";

export const metadata: Metadata = { title: "Store preview", robots: { index: false, follow: false } };

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
