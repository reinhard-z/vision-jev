import { z } from "zod";
import type { DecideRequest } from "../../shared/types";
import {
  CAPTION_MAX_LENGTH,
  DISTANCE_BANDS,
  SPEED_KMH_MAX,
  TURNSTILE_TOKEN_MAX_LENGTH,
  ZONES,
} from "../../shared/types";

/** Captions are untrusted: one line, no control characters. */
export function cleanCaption(caption: string): string {
  // eslint-disable-next-line no-control-regex
  return caption
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A /api/decide body. Unknown fields are rejected, not stripped. */
export const DecideRequestSchema = z.strictObject({
  caption: z
    .string()
    .max(CAPTION_MAX_LENGTH, `caption must be 1–${CAPTION_MAX_LENGTH} chars`)
    .transform(cleanCaption)
    .pipe(z.string().min(1, `caption must be 1–${CAPTION_MAX_LENGTH} chars`)),
  zone: z.enum(ZONES),
  distance: z.enum(DISTANCE_BANDS),
  speedKmh: z.number().int().min(0).max(SPEED_KMH_MAX),
  // Stage 4 verifies the token; until then it's allowed but unused.
  turnstileToken: z.string().max(TURNSTILE_TOKEN_MAX_LENGTH).optional(),
});

export type Parsed = { ok: true; value: DecideRequest } | { ok: false; error: string };

export function parseDecideRequest(body: unknown): Parsed {
  const result = DecideRequestSchema.safeParse(body);
  if (result.success) return { ok: true, value: result.data };
  // One short line for the client; the full issue list isn't useful to it.
  const issue = result.error.issues[0];
  const where = issue?.path.join(".") || "body";
  return { ok: false, error: `${where}: ${issue?.message ?? "invalid"}`.slice(0, 120) };
}
