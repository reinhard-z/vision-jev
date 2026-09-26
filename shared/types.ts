// API contract for POST /api/decide, shared by the frontend and the Worker.
// See docs/SPEC.md "Decision (Worker)". The Worker validates requests with a
// Zod schema (worker/src/validate.ts) that a test pins to DecideRequest.
//
// Jev decides what the car does from the caption and the zone. Distance and
// speed stay in the game, which does the braking and the timers
// (src/game/behaviors.ts maps Jev's action to a game behavior).

/**
 * Where an object is, by its centre: the car's lane, the oncoming lane, or
 * either sidewalk.
 */
export const ZONES = ["own_lane", "oncoming_lane", "sidewalk"] as const;
export type Zone = (typeof ZONES)[number];

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

/** What Jev can tell the car to do. The game carries it out (src/game/behaviors.ts). */
export const ACTIONS = [
  "continue",
  "slow_down",
  "stop",
  "stop_then_go",
  "wait_for_green",
  "go",
  "change_speed",
] as const;
export type Action = (typeof ACTIONS)[number];

export const SPEED_LIMITS = ["30", "50", "80", "120", "none"] as const;
export type SpeedLimit = (typeof SPEED_LIMITS)[number];

export const CAPTION_MAX_LENGTH = 300;
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;

export interface DecideRequest {
  caption: string; // 1–300 chars
  zone: Zone;
  turnstileToken?: string; // added in stage 5
}

export interface ChoiceAnswer<T extends string> {
  choice: T;
  confidence: number;
  /** Every label, 0 when Jev gave none. */
  probabilities: Record<T, number>;
}

export interface DecideResponse {
  /** What the car should do. This drives the car. */
  action: ChoiceAnswer<Action>;
  /** What Jev thinks the object is. Shown, not acted on. */
  category: ChoiceAnswer<Category>;
  /** The number on a speed limit sign, for `change_speed`. */
  speedLimit: ChoiceAnswer<SpeedLimit>;
  latencyMs: number; // Jev call time inside the Worker
}
