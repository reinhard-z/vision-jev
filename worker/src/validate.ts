import type { DecideRequest } from "../../shared/types";
import { CAPTION_MAX_LENGTH, DECIDE_REQUEST_KEYS, DISTANCE_BANDS, SPEED_KMH_MAX, ZONES } from "../../shared/types";

export type Parsed = { ok: true; value: DecideRequest } | { ok: false; error: string };

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** Validate a /api/decide body. Anything outside the spec is rejected. */
export function parseDecideRequest(body: unknown): Parsed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("body must be an object");
  const b = body as Record<string, unknown>;

  const extra = Object.keys(b).filter((k) => !includes(DECIDE_REQUEST_KEYS, k));
  if (extra.length > 0) return fail(`unknown field: ${extra[0]!.slice(0, 40)}`);

  const { caption, zone, distance, speedKmh, turnstileToken } = b;
  if (typeof caption !== "string" || caption.length > CAPTION_MAX_LENGTH) return fail("caption must be 1–300 chars");
  const clean = cleanCaption(caption);
  if (clean.length === 0) return fail("caption must be 1–300 chars");
  if (!includes(ZONES, zone)) return fail("invalid zone");
  if (!includes(DISTANCE_BANDS, distance)) return fail("invalid distance");
  if (typeof speedKmh !== "number" || !Number.isInteger(speedKmh) || speedKmh < 0 || speedKmh > SPEED_KMH_MAX) {
    return fail("speedKmh must be an integer 0–130");
  }
  // Stage 4 verifies the token; until then it's allowed but unused.
  if (turnstileToken !== undefined && (typeof turnstileToken !== "string" || turnstileToken.length > 2048)) {
    return fail("invalid turnstileToken");
  }

  const value: DecideRequest = { caption: clean, zone, distance, speedKmh };
  if (turnstileToken !== undefined) value.turnstileToken = turnstileToken;
  return { ok: true, value };
}

/** Captions are untrusted: one line, no control characters. */
export function cleanCaption(caption: string): string {
  // eslint-disable-next-line no-control-regex
  return caption.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
}

const fail = (error: string): Parsed => ({ ok: false, error });
