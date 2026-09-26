// What Jev sees and what it's asked. Server-only. Jev only classifies the
// caption; what the car does about it is decided in the game
// (src/game/behaviors.ts). Wording is tuned against real captions
// (docs/jev-tuning/).
import type { Category, ChoiceAnswer, DecideRequest, DecideResponse, LightState, SpeedLimit } from "../../shared/types";
import type { ChoiceAnswer as JevChoiceAnswer, JevResult, Questions } from "./jev";

/**
 * Only the caption. Where the object is doesn't change what it is, and
 * describing the zone made Jev less sure about the category (docs/SPEC.md,
 * stage 4 log).
 */
export function buildState(req: DecideRequest): Record<string, string> {
  return { object_seen: req.caption };
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
      harmless_debris:
        "Something light the car can safely drive over, such as a plastic or paper bag, leaves or litter",
      unclear: "`object_seen` is too vague to tell what it is",
    } satisfies Record<Category, string>,
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
  // Literal on purpose: "Could `object_seen` include a child?" also said yes
  // to "a group of people" (88%) and "a person" (83%).
  mentions_child: {
    type: "noul",
    instructions: "Does `object_seen` mention a child?",
    criteria: {
      true: "It names a child, kid, baby, toddler, boy or girl, alone or with adults",
      false: "It names only adults, or no people at all",
    },
  },
} satisfies Questions;

/** Map Jev's answers to the API response. */
export function toDecideResponse(result: JevResult<typeof QUESTIONS>): DecideResponse {
  const a = result.answers;
  return {
    category: choice(a.category),
    lightState: choice(a.light_state),
    speedLimit: choice(a.speed_limit),
    couldBePerson: a.could_be_person.noul,
    mentionsChild: a.mentions_child.noul,
    latencyMs: result.latencyMs,
  };
}

function choice<L extends string>({ choice, confidence, probabilities }: JevChoiceAnswer<L>): ChoiceAnswer<L> {
  return { choice, confidence, probabilities };
}
