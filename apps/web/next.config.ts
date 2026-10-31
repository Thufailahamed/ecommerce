import type { NextConfig } from "next";

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
const dev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy. Next.js emits inline scripts for hydration, so script-src needs 'unsafe-inline'
 * (a nonce-based policy would require dynamic rendering of every page). What this still enforces: no plugins,
 * no framing, no form posts or fetches to unexpected origins, and scripts only from this origin and Turnstile.
 */
const policy = (frameAncestors: string) => [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  // The API serves store images (uploads and AI-generated), over http in local development.
  `img-src 'self' data: blob: https: ${api}`,
  "font-src 'self' data:",
  `connect-src 'self' ${api} https://challenges.cloudflare.com${dev ? " ws:" : ""}`,
  "frame-src 'self' https://challenges.cloudflare.com",
  `frame-ancestors ${frameAncestors}`,
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const csp = policy("'none'");
/** The store builder's live preview is this app framed by itself, so /preview may be framed by this origin only. */
const previewCsp = policy("'self'");

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@convertflow/contracts", "@convertflow/campaign-engine", "@convertflow/storefront-sdk", "@convertflow/integrations", "@convertflow/store-builder"],
  poweredByHeader: false,
  // In dev the API allows exactly one origin (http://localhost:<port>) and its cookie is SameSite=Lax. Opened as
  // 127.0.0.1 (or a LAN address) Next blocks its dev resources, React never hydrates and every click does nothing,
  // so send loopback aliases to the one origin that works.
  async redirects() {
    if (!dev) return [];
    const port = process.env["PORT"] ?? "3000"; // set by `next dev -p`
    return ["127\\.0\\.0\\.1", "\\[::1\\]"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `http://localhost:${port}/:path*`,
      permanent: false,
    }));
  },
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    ];
    return [
      {
        source: "/((?!preview/).*)",
        headers: [{ key: "Content-Security-Policy", value: csp }, { key: "X-Frame-Options", value: "DENY" }, ...common],
      },
      {
        source: "/preview/:path*",
        headers: [{ key: "Content-Security-Policy", value: previewCsp }, { key: "X-Frame-Options", value: "SAMEORIGIN" }, ...common],
      },
    ];
  },
};
export default config;
