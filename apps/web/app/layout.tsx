import type { Metadata } from "next";
import { Manrope, Orbitron, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BRAND_FULL } from "@/lib/brand";

const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
const tech = Orbitron({ subsets: ["latin"], weight: ["500", "600", "700", "800", "900"], variable: "--font-tech" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: BRAND_FULL, template: `%s · ${BRAND_FULL}` },
  description: "Describe a goal. Get a validated on-site campaign, preview it, approve it, and measure what it did. Works with Shopify and any online store.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${tech.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
