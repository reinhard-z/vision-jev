import type { DecideResponse } from "../../shared/types";
import { STOP_SIGN_WAIT_S } from "./constants";
import type { Behavior, Decision, FailedStage, ResolvedBehavior, Zone } from "./types";

/** Anything Jev thinks could be a person above this is treated as one. */
export const SAFETY_PERSON_THRESHOLD = 0.2;
/**
 * People whose caption mentions a child above this count as children. Low on
 * purpose, so a mixed group counts as children too; tuning saw at most 3% for
 * adults and 96% or more for children and mixed groups.
 */
export const CHILD_THRESHOLD = 0.2;

type Move = "continue" | "slow_down" | "stop";

/** Rows of the table: Jev's categories with people split by age. Signs and lights are handled first. */
export type Kind =
  "child" | "person" | "animal" | "vehicle" | "obstacle" | "harmless_debris" | "other_sign" | "unclear";

const row = (own_lane: Move, oncoming_lane: Move, sidewalk: Move): Record<Zone, Move> => ({
  own_lane,
  oncoming_lane,
  sidewalk,
});

/** What the car does about an object, by what it is and where it is (docs/SPEC.md "Behaviors"). */
export const BEHAVIOR_TABLE: Record<Kind, Record<Zone, Move>> = {
  child: row("stop", "stop", "slow_down"),
  person: row("stop", "slow_down", "continue"),
  animal: row("stop", "slow_down", "continue"),
  vehicle: row("stop", "continue", "continue"),
  obstacle: row("stop", "continue", "continue"),
  harmless_debris: row("continue", "continue", "continue"),
  other_sign: row("continue", "continue", "continue"),
  // Also used when vision or Jev failed.
  unclear: row("stop", "slow_down", "continue"),
};

/** Higher is more cautious. */
const CAUTION: Record<Behavior["kind"], number> = {
  continue: 0,
  green_light: 0,
  speed_limit: 0,
  slow_down: 1,
  stop: 2,
  stop_sign: 2,
  red_light: 2,
};

const WHAT: Record<Kind, string> = {
  child: "Child",
  person: "Person",
  animal: "Animal",
  vehicle: "Vehicle",
  obstacle: "Obstacle",
  harmless_debris: "Debris",
  other_sign: "Sign",
  unclear: "Unclear object",
};

const WHERE: Record<Zone, string> = {
  own_lane: "in your lane",
  oncoming_lane: "in the oncoming lane",
  sidewalk: "on the sidewalk",
};

const DO: Record<Move, string> = {
  continue: "continue",
  slow_down: "slow down until passed",
  stop: "stop until cleared",
};

/**
 * Map Jev's answers to a game behavior: signs and lights by category, the
 * rest by the table. Anything that could be a person is treated as one (as a
 * child if its caption mentions one); that safety override is only flagged
 * when it changes the outcome.
 */
export function resolveBehavior(res: DecideResponse, zone: Zone): ResolvedBehavior {
  const kind = tableKind(res);
  const base = kind ? fromTable(kind, zone) : signOrLight(res);
  if (res.category.choice === "person" || res.couldBePerson <= SAFETY_PERSON_THRESHOLD) return base;

  const as = personKind(res);
  const move = BEHAVIOR_TABLE[as][zone];
  if (CAUTION[move] <= CAUTION[base.behavior.kind]) return base;
  return {
    behavior: { kind: move },
    safetyOverride: true,
    label: `${capitalize(DO[move])}: it could be a ${as} (instead of: ${base.label.toLowerCase()})`,
  };
}

/** The behavior for Jev's answer, or for a failure, at `zone`. */
export function resolveOutcome(outcome: Decision["outcome"], zone: Zone): ResolvedBehavior {
  return outcome.kind === "answered" ? resolveBehavior(outcome.response, zone) : failedBehavior(zone, outcome.stage);
}

/** No caption or no decision: treated like an unclear object. */
export function failedBehavior(zone: Zone, stage: FailedStage): ResolvedBehavior {
  const what = stage === "perception" ? "Couldn't see what it is" : "No decision";
  const move = BEHAVIOR_TABLE.unclear[zone];
  return { behavior: { kind: move }, safetyOverride: false, label: `${what}, ${DO[move]}` };
}

/** The table row for Jev's category, or null for signs and lights. */
function tableKind(res: DecideResponse): Kind | null {
  const category = res.category.choice;
  switch (category) {
    case "traffic_light":
    case "stop_sign":
    case "speed_limit_sign":
      return null;
    case "person":
      return personKind(res);
    default:
      return category;
  }
}

function personKind(res: DecideResponse): "child" | "person" {
  return res.mentionsChild > CHILD_THRESHOLD ? "child" : "person";
}

function fromTable(kind: Kind, zone: Zone): ResolvedBehavior {
  const move = BEHAVIOR_TABLE[kind][zone];
  return { behavior: { kind: move }, safetyOverride: false, label: `${WHAT[kind]} ${WHERE[zone]}, ${DO[move]}` };
}

/** Signs and lights apply in every zone. */
function signOrLight(res: DecideResponse): ResolvedBehavior {
  if (res.category.choice === "stop_sign") {
    return {
      behavior: { kind: "stop_sign" },
      safetyOverride: false,
      label: `Stop at sign, wait ${STOP_SIGN_WAIT_S} s`,
    };
  }
  if (res.category.choice === "speed_limit_sign") {
    if (res.speedLimit.choice === "none") {
      return {
        behavior: { kind: "continue" },
        safetyOverride: false,
        label: "Speed limit sign, number not readable: keep speed",
      };
    }
    const kmh = Number(res.speedLimit.choice);
    return { behavior: { kind: "speed_limit", kmh }, safetyOverride: false, label: `Speed limit ${kmh} km/h` };
  }
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
  // `unknown`, or `not_a_light` although the category says it is one.
  return { behavior: { kind: "slow_down" }, safetyOverride: false, label: "Light colour unknown, slow down" };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
