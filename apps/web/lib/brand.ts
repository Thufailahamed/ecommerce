/**
 * Brand is configurable. "ConvertFlow" is also the name of an existing company in the same category:
 * rename before public launch (set NEXT_PUBLIC_BRAND_NAME / NEXT_PUBLIC_BRAND_SUFFIX at build time).
 */
export const BRAND = {
  name: process.env["NEXT_PUBLIC_BRAND_NAME"] ?? "ConvertFlow",
  suffix: process.env["NEXT_PUBLIC_BRAND_SUFFIX"] ?? "AI",
};
export const BRAND_FULL = `${BRAND.name} ${BRAND.suffix}`.trim();
