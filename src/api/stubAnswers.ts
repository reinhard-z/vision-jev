// STAGES 1–2 ONLY. Hand-written fake answers so every behavior can be exercised
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

// Keyed by sample id (src/samples.ts), not by caption, so behaviors stay
// testable whatever the vision model says.
const CANNED: Record<string, Canned> = {
  child: { category: "person", action: onRoad("stop"), couldBePerson: 0.97 },
  adult: { category: "person", action: onRoad("stop"), couldBePerson: 0.95 },
  // Low-confidence obstacle; on the road the safety override kicks in.
  teddy: { category: "obstacle", action: onRoad("slow_down"), couldBePerson: 0.34, confidence: 0.55 },
  dog: { category: "animal", action: { road: "stop", sidewalk: "slow_down" }, couldBePerson: 0.03 },
  cat: { category: "animal", action: onRoad("stop"), couldBePerson: 0.02 },
  bicycle: { category: "vehicle", action: onRoad("stop"), couldBePerson: 0.12 },
  car: { category: "vehicle", action: onRoad("stop"), couldBePerson: 0.01 },
  stop: { category: "stop_sign", action: "stop", couldBePerson: 0.01 },
  red: { category: "traffic_light", action: "stop", light: "red", couldBePerson: 0.01 },
  amber: { category: "traffic_light", action: "slow_down", light: "amber", couldBePerson: 0.01 },
  green: { category: "traffic_light", action: "continue", light: "green", couldBePerson: 0.01 },
  limit30: { category: "speed_limit_sign", action: "continue", limit: "30", couldBePerson: 0.01 },
  limit80: { category: "speed_limit_sign", action: "continue", limit: "80", couldBePerson: 0.01 },
  box: { category: "obstacle", action: onRoad("slow_down"), couldBePerson: 0.02 },
  bag: { category: "harmless_debris", action: "continue", couldBePerson: 0.01 },
  leaves: { category: "harmless_debris", action: "continue", couldBePerson: 0.01 },
};

// Anything else: the user's own images and files dropped onto the road.
const FALLBACK: Canned = { category: "unclear", action: onRoad("stop"), couldBePerson: 0.15, confidence: 0.4 };

function choice<T extends string>(labels: readonly T[], pick: T, confidence: number): ChoiceAnswer<T> {
  const rest = (1 - confidence) / (labels.length - 1);
  const probabilities = Object.fromEntries(labels.map((l) => [l, l === pick ? confidence : rest])) as Record<T, number>;
  return { choice: pick, confidence, probabilities };
}

export function cannedAnswer(req: DecideRequest, sampleId: string | undefined, latencyMs: number): DecideResponse {
  const c = (sampleId !== undefined ? CANNED[sampleId] : undefined) ?? FALLBACK;
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
