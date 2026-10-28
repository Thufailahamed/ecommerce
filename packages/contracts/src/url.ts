import { z } from "zod";

/** Only https URLs or same-site relative paths. Blocks javascript:, data:, protocol-relative. */
export const SafeUrl = z
  .string()
  .max(2048)
  .refine((v) => {
    // No surrounding whitespace, control characters or backslashes: browsers normalise "/\evil.com"
    // to "//evil.com" (protocol-relative), and URL parsers silently trim leading whitespace.
    // eslint-disable-next-line no-control-regex
    if (v !== v.trim() || /[\u0000-\u001f\u007f\\]/.test(v)) return false;
    if (v.startsWith("/")) return !v.startsWith("//");
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "URL must be https or a same-site relative path");
