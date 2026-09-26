// API contract for POST /api/decide, shared by the frontend and the Worker.
// See docs/SPEC.md "Decision (Worker)". The Worker validates requests with a
// Zod schema (worker/src/validate.ts) that a test pins to DecideRequest.
//
// Jev only classifies the caption. Where the object is and what the car does
// about it are game concerns (src/game/behaviors.ts), so zone, distance and
// speed never reach the Worker.

export const CATEGORIES = [
  "person",
  "animal",
  "vehicle",
  "traffic_light",
  "stop_sign",
  "speed_limit_sign",
  "other_sign",
  "obstacle",
  "harmless_debris",
  "unclear",
] as const;
export type Category = (typeof CATEGORIES)[number];

// `unknown`: a traffic light whose caption doesn't say which lamp is lit.
export const LIGHT_STATES = ["red", "amber", "green", "unknown", "not_a_light"] as const;
export type LightState = (typeof LIGHT_STATES)[number];

export const SPEED_LIMITS = ["30", "50", "80", "120", "none"] as const;
export type SpeedLimit = (typeof SPEED_LIMITS)[number];

export const CAPTION_MAX_LENGTH = 300;
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export interface DecideRequest {
  caption: string; // 1–300 chars
  turnstileToken?: string; // added in stage 5
}

export interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  /** Every label, 0 when Jev gave none. */
  probabilities: Record<T, number>;
}

export interface DecideResponse {
  category: ChoiceAnswer<Category>;
  lightState: ChoiceAnswer<LightState>;
  speedLimit: ChoiceAnswer<SpeedLimit>;
  couldBePerson: number;
  /** Does the caption mention a child (alone or with adults)? */
  mentionsChild: number;
  latencyMs: number; // Jev call time inside the Worker
}
