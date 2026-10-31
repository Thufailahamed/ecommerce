import { Cormorant_Garamond, DM_Sans, DM_Serif_Display, Fraunces, Inter, Manrope, Outfit, Playfair_Display, Space_Grotesk, Syne } from "next/font/google";
import { FONTS, type FontKey } from "@convertflow/store-builder";

// A store uses two of these ten, so none is preloaded: the browser fetches only the faces the theme actually uses.
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-inter" });
const dmSans = DM_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-dm-sans" });
const manrope = Manrope({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-manrope" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-outfit" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-space-grotesk" });
const syne = Syne({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-syne" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-playfair" });
const fraunces = Fraunces({ subsets: ["latin"], display: "swap", preload: false, variable: "--sf-font-fraunces" });
const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], display: "swap", preload: false, variable: "--sf-font-cormorant" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--sf-font-dm-serif" });

const VARS: Record<FontKey, string> = {
  inter: "--sf-font-inter", dm_sans: "--sf-font-dm-sans", manrope: "--sf-font-manrope", outfit: "--sf-font-outfit",
  space_grotesk: "--sf-font-space-grotesk", syne: "--sf-font-syne", playfair: "--sf-font-playfair", fraunces: "--sf-font-fraunces",
  cormorant: "--sf-font-cormorant", dm_serif: "--sf-font-dm-serif",
};

export const storefrontFontClass = [inter, dmSans, manrope, outfit, spaceGrotesk, syne, playfair, fraunces, cormorant, dmSerif].map((f) => f.variable).join(" ");

export function fontVar(key: FontKey): string {
  const fallback = FONTS[key].kind === "serif" ? "Georgia, 'Times New Roman', serif" : "system-ui, -apple-system, 'Segoe UI', sans-serif";
  return `var(${VARS[key]}), ${fallback}`;
}
