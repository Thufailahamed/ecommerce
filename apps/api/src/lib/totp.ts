/** RFC 6238 TOTP (HMAC-SHA1, 30 s step, 6 digits) with RFC 4648 base32 secrets, via Web Crypto. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function generateSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const o = (h[19] ?? 0) & 0xf;
  const code = (((h[o] ?? 0) & 0x7f) << 24) | (((h[o + 1] ?? 0) & 0xff) << 16) | (((h[o + 2] ?? 0) & 0xff) << 8) | ((h[o + 3] ?? 0) & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export async function totpAt(secretB32: string, nowMs: number, digits = 6, step = 30): Promise<string> {
  return hotp(base32Decode(secretB32), Math.floor(nowMs / 1000 / step), digits);
}

/** Accepts the current code and one step either side to tolerate clock drift. Constant-time per candidate. */
export async function verifyTotp(secretB32: string, code: string, nowMs: number, window = 1): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = await totpAt(secretB32, nowMs + w * 30_000);
    let diff = 0;
    for (let i = 0; i < 6; i++) diff |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
