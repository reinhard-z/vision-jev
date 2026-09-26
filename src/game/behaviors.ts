import type { DecideResponse, Zone } from "../../shared/types";
import { STOP_SIGN_WAIT_S } from "./constants";
import type { FailedStage, ResolvedBehavior } from "./types";

export const SAFETY_PERSON_THRESHOLD = 0.2;

/**
 * Map Jev's answers to a game behavior (docs/SPEC.md "Behaviors").
 * The safety override wins over everything, but is only flagged when it
 * actually changes the outcome.
 */
export function resolveBehavior(res: DecideResponse, zone: Zone): ResolvedBehavior {
  const base = resolveFromAnswers(res);
  if (zone === "road" && res.couldBePerson > SAFETY_PERSON_THRESHOLD && base.behavior.kind !== "stop") {
    return {
      behavior: { kind: "stop" },
      safetyOverride: true,
      label: `Stop: it could be a person (instead of: ${base.label.toLowerCase()})`,
    };
  }
  return base;
}

/**
 * When there is no caption or no decision: stop on the road (the old
 * `unclear` default), ignore on the sidewalk.
 */
export function failedBehavior(zone: Zone, stage: FailedStage): ResolvedBehavior {
  const what = stage === "perception" ? "Couldn't see what it is" : "No decision";
  return zone === "road"
    ? { behavior: { kind: "stop" }, safetyOverride: false, label: `${what}, stop until cleared` }
    : { behavior: { kind: "continue" }, safetyOverride: false, label: `${what}, continue` };
}

/** Signs and lights by category first, otherwise the chosen action. */
function resolveFromAnswers(res: DecideResponse): ResolvedBehavior {
  const category = res.category.choice;
  if (category === "stop_sign") {
    return {
      behavior: { kind: "stop_sign" },
      safetyOverride: false,
      label: `Stop at sign, wait ${STOP_SIGN_WAIT_S} s`,
    };
  }
  if (category === "traffic_light") {
    const light = res.lightState.choice;
    if (light === "red" || light === "amber") {
      return {
        behavior: { kind: "red_light", light },
        safetyOverride: false,
        label: `Stop at ${light} light, wait for green`,
      };
    }
    if (light === "green") {
      return { behavior: { kind: "green_light" }, safetyOverride: false, label: "Green light, continue" };
    }
    if (light === "unknown") {
      return { behavior: { kind: "slow_down" }, safetyOverride: false, label: "Light colour unknown, slow down" };
    }
  }
  if (category === "speed_limit_sign") {
    if (res.speedLimit.choice === "none") {
      return {
        behavior: { kind: "continue" },
        safetyOverride: false,
        label: "Speed limit sign, number not readable: keep speed",
      };
    }
    const kmh = Number(res.speedLimit.choice);
    return {
      behavior: { kind: "speed_limit", kmh },
      safetyOverride: false,
      label: `Speed limit ${kmh} km/h`,
    };
  }

  switch (res.action.choice) {
    case "continue":
      return { behavior: { kind: "continue" }, safetyOverride: false, label: "Continue" };
    case "slow_down":
      return { behavior: { kind: "slow_down" }, safetyOverride: false, label: "Slow down until passed" };
    case "stop":
      return { behavior: { kind: "stop" }, safetyOverride: false, label: "Stop until cleared" };
  }
}
