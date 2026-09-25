import type { DecideResponse, DistanceBand, Zone } from "../../shared/types";

/** What the game does about an object, derived from Jev's answers. */
export type Behavior =
  | { kind: "continue" }
  | { kind: "slow_down" } // 50% of target speed until passed
  | { kind: "stop" } // hold until removed or moved off the road
  | { kind: "stop_sign" } // stop, wait 2 s, continue
  | { kind: "red_light"; light: "red" | "amber" } // hold until green or removed
  | { kind: "green_light" }
  | { kind: "speed_limit"; kmh: number };

export interface ResolvedBehavior {
  behavior: Behavior;
  safetyOverride: boolean;
  label: string; // human-readable, shown in the thoughts panel
}

export type ObjectStatus = "perceiving" | "decided" | "too_late";

export interface GameObject {
  id: string;
  image: HTMLImageElement;
  imageUrl: string;
  zone: Zone;
  x: number; // CSS px, screen column
  s: number; // metres along the road
  status: ObjectStatus;
  caption?: string;
  visionMs?: number;
  distanceBand?: DistanceBand;
  response?: DecideResponse;
  resolved?: ResolvedBehavior;
  /** Bumped whenever a pending decision becomes stale (moved, re-zoned). */
  requestSeq: number;
  released: boolean; // stop sign done waiting, or light turned green
  waitStartedAt?: number; // stop sign wait start, game time in s
  speedLimitApplied: boolean;
  passed: boolean;
  removed: boolean;
  tooLateReason?: string;
  dragging: boolean;
}

/** Plain snapshot of an object for React. Emitted on status changes only. */
export interface ObjectSnapshot {
  id: string;
  imageUrl: string;
  zone: Zone;
  status: ObjectStatus;
  caption?: string;
  visionMs?: number;
  distanceBand?: DistanceBand;
  response?: DecideResponse;
  resolved?: ResolvedBehavior;
  released: boolean;
  passed: boolean;
  removed: boolean;
  tooLateReason?: string;
  addedAt: number; // wall clock ms, for ordering
}
