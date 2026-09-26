import { COMFORT_DECEL } from "./constants";

export const kmhToMs = (kmh: number) => kmh / 3.6;
export const msToKmh = (ms: number) => ms * 3.6;

/** Highest speed from which the car can still stop within `distanceM`. */
export function maxSpeedToStopWithin(distanceM: number, decel = COMFORT_DECEL): number {
  return Math.sqrt(2 * decel * Math.max(0, distanceM));
}
