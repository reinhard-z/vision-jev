// A session is a signed expiry time, handed out once a Turnstile challenge is
// solved, so each decision doesn't need its own challenge (Turnstile tokens
// are single-use). Nothing is stored: the signature is the proof.

export const SESSION_COOKIE = "jev_session";
export const SESSION_TTL_MS = 60 * 60 * 1000;

/** A cookie value that is valid until `expiresAt` (ms since the epoch). */
export async function signSession(secret: string, expiresAt: number): Promise<string> {
  const payload = `v1.${expiresAt}`;
  return `${payload}.${await sign(secret, payload)}`;
}

/** True if the cookie value was signed with `secret` and hasn't expired. */
export async function verifySession(secret: string, value: string | undefined, now: number): Promise<boolean> {
  const match = value?.match(/^(v1\.(\d{1,15}))\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;
  const [, payload = "", expiresAt = "", signature = ""] = match;
  if (Number(expiresAt) <= now) return false;
  return crypto.subtle.verify("HMAC", await key(secret), fromBase64Url(signature), encode(payload));
}

async function sign(secret: string, payload: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await key(secret), encode(payload));
  return toBase64Url(new Uint8Array(mac));
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
