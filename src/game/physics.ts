import type { DistanceBand } from "../../shared/types";
import { COMFORT_DECEL, MEDIUM_FACTOR, NEAR_FACTOR } from "./constants";

export const kmhToMs = (kmh: number) => kmh / 3.6;
export const msToKmh = (ms: number) => ms * 3.6;

/** Distance needed to stop from `speedMs` at comfortable braking. */
export function stoppingDistance(speedMs: number, decel = COMFORT_DECEL): number {
  return (speedMs * speedMs) / (2 * decel);
}

/** Highest speed from which the car can still stop within `distanceM`. */
export function maxSpeedToStopWithin(distanceM: number, decel = COMFORT_DECEL): number {
  return Math.sqrt(2 * decel * Math.max(0, distanceM));
}

/**
 * Band for Jev. `near` means braking now is barely enough.
 * A small floor keeps a standing car from calling everything "far".
 */
export function distanceBand(distanceM: number, speedMs: number): DistanceBand {
  const stop = Math.max(stoppingDistance(speedMs), 4);
  if (distanceM < stop * NEAR_FACTOR) return "near";
  if (distanceM < stop * MEDIUM_FACTOR) return "medium";
  return "far";
}
