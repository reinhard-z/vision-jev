import type { Action, Category, DecideResponse } from "../../shared/types";
import { STOP_SIGN_WAIT_S } from "./constants";
import type { Behavior, FailedStage, ResolvedBehavior, Zone } from "./types";

/**
 * Jev decides what the car does; this only carries its action out. The game
 * adds what Jev can't do: the speeds, the stop line, the timers.
 */
export function resolveBehavior(res: DecideResponse, zone: Zone): ResolvedBehavior {
  const what = `${capitalize(WHAT[res.category.choice])} ${WHERE[zone]}`;
  const behavior = toBehavior(res.action.choice, res);
  const unreadable = res.action.choice === "change_speed" && behavior.kind === "continue";
  return {
    behavior,
    label: `${what}: ${unreadable ? "change speed, no number read: keep speed" : describe(behavior)}`,
  };
}

/**
 * Without a caption or an answer from Jev there is nothing to decide with:
 * stop for it in the car's lane, slow down beside it, ignore it on the sidewalk.
 */
export const NO_DECISION: Record<Zone, "continue" | "slow_down" | "stop"> = {
  own_lane: "stop",
  oncoming_lane: "slow_down",
  sidewalk: "continue",
};

export function failedBehavior(zone: Zone, stage: FailedStage): ResolvedBehavior {
  const what = stage === "perception" ? "Couldn't see what it is" : "No decision";
  const behavior: Behavior = { kind: NO_DECISION[zone] };
  return { behavior, label: `${what}, ${describe(behavior)}` };
}

function toBehavior(action: Action, res: DecideResponse): Behavior {
  switch (action) {
    case "continue":
    case "slow_down":
    case "stop":
      return { kind: action };
    case "stop_then_go":
      return { kind: "stop_sign" };
    case "wait_for_green":
      return { kind: "red_light" };
    case "go":
      return { kind: "green_light" };
    case "change_speed":
      // Jev read no number on it: there is no speed to change to.
      return res.speedLimit.choice === "none"
        ? { kind: "continue" }
        : { kind: "speed_limit", kmh: Number(res.speedLimit.choice) };
  }
}

function describe(b: Behavior): string {
  switch (b.kind) {
    case "continue":
      return "continue";
    case "slow_down":
      return "slow down until passed";
    case "stop":
      return "stop until cleared";
    case "stop_sign":
      return `stop, wait ${STOP_SIGN_WAIT_S} s, go`;
    case "red_light":
      return "stop, wait for green";
    case "green_light":
      return "go";
    case "speed_limit":
      return `change speed to ${b.kmh} km/h`;
  }
}

const WHAT: Record<Category, string> = {
  person: "person",
  animal: "animal",
  vehicle: "vehicle",
  traffic_light: "traffic light",
  stop_sign: "stop sign",
  speed_limit_sign: "speed limit sign",
  other_sign: "sign",
  obstacle: "obstacle",
  harmless_debris: "debris",
  unclear: "something unclear",
};

const WHERE: Record<Zone, string> = {
  own_lane: "in your lane",
  oncoming_lane: "in the oncoming lane",
  sidewalk: "on the sidewalk",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
