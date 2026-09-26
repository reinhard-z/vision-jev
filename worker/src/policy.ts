// What Jev sees and what it's asked. Server-only. Jev decides what the car
// does about an object from what it is and where it is; the game carries that
// out (src/game/behaviors.ts). Wording is tuned against real captions
// (docs/jev-tuning/).
import type {
  Action,
  Category,
  ChoiceAnswer,
  DecideRequest,
  DecideResponse,
  SpeedLimit,
  Zone,
} from "../../shared/types";
import type { ChoiceAnswer as JevChoiceAnswer, JevResult, Questions } from "./jev";

const LOCATION: Record<Zone, string> = {
  own_lane: "on the road, in the car's lane, ahead of the car",
  oncoming_lane: "on the road, in the oncoming lane next to the car's lane",
  near_sidewalk: "on the sidewalk right beside the car's lane, not on the road",
  far_sidewalk: "on the sidewalk across the road, beyond the oncoming lane, not on the road",
};

/** The caption and where the object is, in words. */
export function buildState(req: DecideRequest): Record<string, string> {
  return { object_seen: req.caption, location: LOCATION[req.zone] };
}

export const QUESTIONS = {
  action: {
    type: "choice",
    instructions: "What should the car do about `object_seen`, which is `location`?",
    criteria: {
      continue:
        "Drive on at the current speed: it can't get into the car's way, or it is light enough to drive over, such as a bag, paper or leaves",
      slow_down:
        "Drive on at half speed until past it: a person or animal that is not in the car's lane, but could move into it",
      stop: "Stop before it and wait until it is gone: a person, animal, vehicle or solid object blocks the car's lane",
      stop_then_go: "Stop at it, wait two seconds, then drive on: a stop sign",
      wait_for_green: "Stop at it and wait until a light turns green: a red or amber traffic light",
      go: "Drive on, and go again if waiting at a light: a green traffic light",
      change_speed: "Change the car's speed to the number on it: a speed limit sign",
    } satisfies Record<Action, string>,
  },
  category: {
    type: "choice",
    instructions: "What kind of thing is described in `object_seen`?",
    criteria: {
      person: "One or more people of any age: a child, an adult, pedestrians",
      animal: "An animal, such as a dog, cat, deer or bird",
      vehicle: "A vehicle, such as a car, truck, bus, motorbike, bicycle or scooter",
      traffic_light: "A traffic light",
      stop_sign: "A stop sign",
      speed_limit_sign: "A speed limit sign",
      other_sign: "Any other sign",
      obstacle: "A solid object that could damage the car or block the road, such as a box, rock, toy or furniture",
      harmless_debris:
        "Something light the car can safely drive over, such as a plastic or paper bag, leaves or litter",
      unclear: "`object_seen` is too vague to tell what it is",
    } satisfies Record<Category, string>,
  },
  speed_limit: {
    type: "choice",
    instructions: "Which speed limit number is written in `object_seen`?",
    criteria: {
      "30": "The number 30",
      "50": "The number 50",
      "80": "The number 80",
      "120": "The number 120",
      none: "No speed limit number is written in `object_seen`",
    } satisfies Record<SpeedLimit, string>,
  },
} satisfies Questions;

/** Map Jev's answers to the API response. */
export function toDecideResponse(result: JevResult<typeof QUESTIONS>): DecideResponse {
  const a = result.answers;
  return {
    action: choice(a.action),
    category: choice(a.category),
    speedLimit: choice(a.speed_limit),
    latencyMs: result.latencyMs,
  };
}

function choice<L extends string>({ choice, confidence, probabilities }: JevChoiceAnswer<L>): ChoiceAnswer<L> {
  return { choice, confidence, probabilities };
}
