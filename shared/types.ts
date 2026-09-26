// API contract for POST /api/decide, shared by the frontend and the Worker.
// See docs/SPEC.md "Decision (Worker)". The Worker validates requests with a
// Zod schema (worker/src/validate.ts) that a test pins to DecideRequest.

export const ZONES = ["road", "sidewalk"] as const;
export type Zone = (typeof ZONES)[number];

export const DISTANCE_BANDS = ["far", "medium", "near"] as const;
export type DistanceBand = (typeof DISTANCE_BANDS)[number];

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

export const ACTIONS = ["continue", "slow_down", "stop"] as const;
export type Action = (typeof ACTIONS)[number];

// `unknown`: a traffic light whose caption doesn't say which lamp is lit.
export const LIGHT_STATES = ["red", "amber", "green", "unknown", "not_a_light"] as const;
export type LightState = (typeof LIGHT_STATES)[number];

export const SPEED_LIMITS = ["30", "50", "80", "120", "none"] as const;
export type SpeedLimit = (typeof SPEED_LIMITS)[number];

export const CAPTION_MAX_LENGTH = 300;
export const SPEED_KMH_MAX = 130;
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export interface DecideRequest {
  caption: string; // 1–300 chars
  zone: Zone;
  distance: DistanceBand;
  speedKmh: number; // integer 0–130
  turnstileToken?: string; // added in stage 4
}

export interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  /** Every label, 0 when Jev gave none. */
  probabilities: Record<T, number>;
}

export interface DecideResponse {
  category: ChoiceAnswer<Category>;
  action: ChoiceAnswer<Action>;
  lightState: ChoiceAnswer<LightState>;
  speedLimit: ChoiceAnswer<SpeedLimit>;
  couldBePerson: number;
  latencyMs: number; // Jev call time inside the Worker
}
