import type { DecideResponse, Zone } from "../../shared/types";

export { ZONES, type Zone } from "../../shared/types";

/** Short names for the UI. */
export const ZONE_LABEL: Record<Zone, string> = {
  own_lane: "your lane",
  oncoming_lane: "oncoming lane",
  near_sidewalk: "near sidewalk",
  far_sidewalk: "far sidewalk",
};

/** What the game does about an object: Jev's action, carried out. */
export type Behavior =
  | { kind: "continue" }
  | { kind: "slow_down" } // 50% of target speed until passed
  | { kind: "stop" } // hold until removed, or Jev says otherwise after a move
  | { kind: "stop_sign" } // stop, wait 2 s, continue
  | { kind: "red_light" } // hold until green or removed
  | { kind: "green_light" }
  | { kind: "speed_limit"; kmh: number };

export interface ResolvedBehavior {
  behavior: Behavior;
  label: string; // human-readable, shown in the thoughts panel
}

/**
 * Where an object is in its life. Exactly one phase at a time; whatever a
 * phase doesn't carry doesn't apply, so a transition can't leave stale flags.
 */
export type Phase =
  | { kind: "perceiving" } // waiting for the vision model
  | { kind: "deciding" } // caption known, waiting for Jev; a previous `decision` still drives the car
  | { kind: "decided" } // `decision` drives the car
  | { kind: "too_late"; reason: string } // reached without a usable decision; holds until cleared
  | { kind: "passed" } // behind the car
  | { kind: "removed" };

export type PhaseKind = Phase["kind"];

/** Why there is no answer from Jev: no caption, or no decision. */
export type FailedStage = "perception" | "decision";

/** The behavior an object currently asks for, decided for the zone it was in when asked. */
export interface Decision {
  resolved: ResolvedBehavior;
  outcome:
    | { kind: "answered"; response: DecideResponse; roundTripMs?: number } // browser round trip
    | { kind: "failed"; stage: FailedStage };
  /** Stop sign waited out, or red light turned green. */
  released: boolean;
  waitStartedAt?: number; // stop sign wait start, game time in s
  speedLimitApplied: boolean;
}

export interface GameObject {
  id: string;
  image: HTMLImageElement;
  imageUrl: string;
  zone: Zone;
  x: number; // CSS px, screen column
  s: number; // metres along the road
  phase: Phase;
  caption?: string;
  visionMs?: number;
  decision?: Decision;
  /** Bumped whenever a pending decision becomes stale (removed, or asked again). */
  requestSeq: number;
  dragging: boolean;
}

/** Plain, immutable copy of an object for React. Emitted on changes only. */
export interface ObjectSnapshot {
  id: string;
  imageUrl: string;
  zone: Zone;
  phase: Phase;
  caption?: string;
  visionMs?: number;
  decision?: Decision;
  addedAt: number; // wall clock ms, for ordering
}
