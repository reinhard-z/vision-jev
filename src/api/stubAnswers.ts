// STAGE 1 ONLY. Hand-written fake answers so every behavior can be exercised
// before Jev is wired up. Deleted in stage 3.
import type {
  Action,
  Category,
  ChoiceAnswer,
  DecideRequest,
  DecideResponse,
  LightState,
  SpeedLimit,
} from "../../shared/types";
import { ACTIONS, CATEGORIES, LIGHT_STATES, SPEED_LIMITS } from "../../shared/types";

interface Canned {
  category: Category;
  action: Action | { road: Action; sidewalk: Action };
  light?: LightState;
  limit?: SpeedLimit;
  couldBePerson: number;
  confidence?: number;
}

const onRoad = (road: Action): Canned["action"] => ({ road, sidewalk: "continue" });

// Keyed by the placeholder captions in src/samples.ts.
const CANNED: Record<string, Canned> = {
  "a small child in a red jacket standing": { category: "person", action: onRoad("stop"), couldBePerson: 0.97 },
  "an adult man walking across the street": { category: "person", action: onRoad("stop"), couldBePerson: 0.95 },
  // Low-confidence obstacle; on the road the safety override kicks in.
  "a teddy bear lying on the ground": { category: "obstacle", action: onRoad("slow_down"), couldBePerson: 0.34, confidence: 0.55 },
  "a brown dog standing on the pavement": { category: "animal", action: { road: "stop", sidewalk: "slow_down" }, couldBePerson: 0.03 },
  "a grey cat sitting": { category: "animal", action: onRoad("stop"), couldBePerson: 0.02 },
  "a bicycle": { category: "vehicle", action: onRoad("stop"), couldBePerson: 0.12 },
  "a red car parked": { category: "vehicle", action: onRoad("stop"), couldBePerson: 0.01 },
  "a red octagonal stop sign": { category: "stop_sign", action: "stop", couldBePerson: 0.01 },
  "a traffic light with the red lamp lit": { category: "traffic_light", action: "stop", light: "red", couldBePerson: 0.01 },
  "a traffic light with the amber lamp lit": { category: "traffic_light", action: "slow_down", light: "amber", couldBePerson: 0.01 },
  "a traffic light with the green lamp lit": { category: "traffic_light", action: "continue", light: "green", couldBePerson: 0.01 },
  "a round speed limit sign showing 30": { category: "speed_limit_sign", action: "continue", limit: "30", couldBePerson: 0.01 },
  "a round speed limit sign showing 80": { category: "speed_limit_sign", action: "continue", limit: "80", couldBePerson: 0.01 },
  "a cardboard box": { category: "obstacle", action: onRoad("slow_down"), couldBePerson: 0.02 },
  "a plastic shopping bag": { category: "harmless_debris", action: "continue", couldBePerson: 0.01 },
  "a pile of dry autumn leaves": { category: "harmless_debris", action: "continue", couldBePerson: 0.01 },
};

// Anything else (e.g. the user's own files before stage 2 captions them).
const FALLBACK: Canned = { category: "unclear", action: onRoad("stop"), couldBePerson: 0.15, confidence: 0.4 };

function choice<T extends string>(labels: readonly T[], pick: T, confidence: number): ChoiceAnswer<T> {
  const rest = (1 - confidence) / (labels.length - 1);
  const probabilities = Object.fromEntries(labels.map((l) => [l, l === pick ? confidence : rest])) as Record<T, number>;
  return { choice: pick, confidence, probabilities };
}

export function cannedAnswer(req: DecideRequest, latencyMs: number): DecideResponse {
  const c = CANNED[req.caption] ?? FALLBACK;
  const conf = c.confidence ?? 0.9;
  const action = typeof c.action === "string" ? c.action : c.action[req.zone];
  return {
    category: choice(CATEGORIES, c.category, conf),
    action: choice(ACTIONS, action, conf),
    lightState: choice(LIGHT_STATES, c.light ?? "not_a_light", conf),
    speedLimit: choice(SPEED_LIMITS, c.limit ?? "none", conf),
    couldBePerson: c.couldBePerson,
    latencyMs,
  };
}
