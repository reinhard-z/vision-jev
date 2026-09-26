// The driving policy: what Jev sees and what it's asked. Server-only.
// Wording is tuned against real captions (docs/jev-tuning/).
import type {
  Action,
  Category,
  ChoiceAnswer,
  DecideRequest,
  DecideResponse,
  DistanceBand,
  LightState,
  SpeedLimit,
  Zone,
} from "../../shared/types";
import type { ChoiceAnswer as JevChoiceAnswer, JevResult, Questions } from "./jev";

const LOCATION: Record<Zone, string> = {
  road: "on the road, in the car's lane",
  sidewalk: "on the sidewalk next to the road, not on the road",
};

const DISTANCE: Record<DistanceBand, string> = {
  far: "far ahead, plenty of room to stop",
  medium: "ahead, room to stop with firm braking",
  near: "close ahead, braking now is barely enough",
};

/** Small, readable state. Numbers are turned into words in code. */
export function buildState(req: DecideRequest): Record<string, string> {
  return {
    object_seen: req.caption,
    location: LOCATION[req.zone],
    distance: DISTANCE[req.distance],
    car_speed: req.speedKmh === 0 ? "stopped" : `${req.speedKmh} km/h`,
  };
}

export const QUESTIONS = {
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
      harmless_debris: "Something light the car can safely drive over, such as a plastic or paper bag, leaves or litter",
      unclear: "`object_seen` is too vague to tell what it is",
    } satisfies Record<Category, string>,
  },
  action: {
    type: "choice",
    instructions: "What should the car do about `object_seen`, which is `location`?",
    criteria: {
      continue:
        "Nothing on the road needs a reaction: signs, lights, light debris the car can drive over such as a bag, leaves or litter, and things on the sidewalk that are not entering the road",
      slow_down: "Something could enter the road soon, or a small solid obstacle is ahead",
      stop: "A person, animal, vehicle, or obstacle is on the road. If it is unclear whether something is a person, treat it as a person",
    } satisfies Record<Action, string>,
  },
  light_state: {
    type: "choice",
    instructions: "If `object_seen` is a traffic light, which lamp does `object_seen` say is lit?",
    criteria: {
      red: "The red lamp is lit",
      amber: "The amber or yellow lamp is lit",
      green: "The green lamp is lit",
      unknown: "A traffic light, but `object_seen` does not say which colour is lit",
      not_a_light: "`object_seen` is not a traffic light",
    } satisfies Record<LightState, string>,
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
  could_be_person: {
    type: "noul",
    instructions: "Could `object_seen` be a person, or easily be mistaken for one?",
    criteria: {
      true: "A person, a child, or a human-like figure such as a doll, stuffed toy or mannequin",
      false: "Clearly not a person",
    },
  },
} satisfies Questions;

/** Map Jev's answers to the API response. */
export function toDecideResponse(result: JevResult<typeof QUESTIONS>): DecideResponse {
  const a = result.answers;
  return {
    category: choice(a.category),
    action: choice(a.action),
    lightState: choice(a.light_state),
    speedLimit: choice(a.speed_limit),
    couldBePerson: a.could_be_person.noul,
    latencyMs: result.latencyMs,
  };
}

function choice<L extends string>({ choice, confidence, probabilities }: JevChoiceAnswer<L>): ChoiceAnswer<L> {
  return { choice, confidence, probabilities };
}
