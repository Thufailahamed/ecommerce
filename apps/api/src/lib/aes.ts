import { b64url } from "./crypto.js";

function fromB64(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function key(keyB64: string) {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("credential key must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-256-GCM. Output: "v1.<iv>.<ciphertext>" (base64url). A fresh random IV per call. */
export async function encrypt(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(keyB64), new TextEncoder().encode(plain));
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function decrypt(blob: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unrecognised ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(keyB64), fromB64(ct));
  return new TextDecoder().decode(pt);
}
