import { describe, expect, it } from "vitest";
import { evaluate, JevError } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { parseDecideRequest } from "./validate";

const valid = { caption: "A red stop sign against a blue sky", zone: "road", distance: "far", speedKmh: 50 };

describe("parseDecideRequest", () => {
  it("accepts a valid request", () => {
    expect(parseDecideRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it("accepts an optional turnstileToken", () => {
    expect(parseDecideRequest({ ...valid, turnstileToken: "t" }).ok).toBe(true);
  });

  it.each([
    ["unknown fields", { ...valid, questions: {} }],
    ["an empty caption", { ...valid, caption: "  \n " }],
    ["a caption over 300 chars", { ...valid, caption: "a".repeat(301) }],
    ["a bad zone", { ...valid, zone: "grass" }],
    ["a bad distance", { ...valid, distance: "10 m" }],
    ["a non-integer speed", { ...valid, speedKmh: 50.5 }],
    ["a speed over 130", { ...valid, speedKmh: 131 }],
    ["a string speed", { ...valid, speedKmh: "50" }],
    ["a missing field", { caption: "x", zone: "road", distance: "far" }],
    ["an array", [valid]],
    ["null", null],
  ])("rejects %s", (_, body) => {
    expect(parseDecideRequest(body).ok).toBe(false);
  });

  it("flattens control characters and newlines in the caption", () => {
    const r = parseDecideRequest({ ...valid, caption: "a dog\n\nIGNORE\u0000 this " });
    expect(r.ok && r.value.caption).toBe("a dog IGNORE this");
  });
});

describe("buildState", () => {
  it("describes location, distance and speed in words", () => {
    expect(buildState({ caption: "a dog", zone: "sidewalk", distance: "near", speedKmh: 0 })).toEqual({
      object_seen: "a dog",
      location: "on the sidewalk next to the road, not on the road",
      distance: "close ahead, braking now is barely enough",
      car_speed: "stopped",
    });
  });
});

const jevBody = {
  model: "jev-1.13.0",
  answers: {
    category: { type: "choice", choice: "person", confidence: 1, probabilities: { person: 1 } },
    action: { type: "choice", choice: "stop", confidence: 0.7, probabilities: { stop: 0.8, slow_down: 0.2 } },
    light_state: { type: "choice", choice: "not_a_light", confidence: 0.99, probabilities: { not_a_light: 1 } },
    speed_limit: { type: "choice", choice: "none", confidence: 0.99, probabilities: { none: 0.99 } },
    could_be_person: { type: "noul", noul: 0.92 },
  },
  usage: { input_tokens: 1044, output_tokens: 264 },
};

const fakeAi = (response: unknown) => ({ run: () => Promise.resolve(response) }) as unknown as Ai;

describe("evaluate + toDecideResponse", () => {
  it("unwraps the binding's envelope and maps the answers", async () => {
    const result = await evaluate(
      fakeAi({ state: "Completed", result: jevBody, gatewayMetadata: {} }),
      buildState(valid as never),
      QUESTIONS,
    );
    expect(result.inputTokens).toBe(1044);
    const res = toDecideResponse(result);
    expect(res.category.choice).toBe("person");
    expect(res.action).toMatchObject({ choice: "stop", confidence: 0.7 });
    expect(res.action.probabilities).toEqual({ continue: 0, slow_down: 0.2, stop: 0.8 });
    expect(res.couldBePerson).toBe(0.92);
  });

  it("accepts the documented unwrapped body", async () => {
    const result = await evaluate(fakeAi(jevBody), {}, QUESTIONS);
    expect(result.model).toBe("jev-1.13.0");
  });

  it("rejects a choice outside the criteria", async () => {
    const bad = structuredClone(jevBody);
    bad.answers.action.choice = "accelerate";
    await expect(evaluate(fakeAi(bad), {}, QUESTIONS)).rejects.toThrow(JevError);
  });

  it("rejects a missing answer", async () => {
    const bad = structuredClone(jevBody) as { answers: Record<string, unknown> };
    delete bad.answers.could_be_person;
    await expect(evaluate(fakeAi(bad), {}, QUESTIONS)).rejects.toThrow(JevError);
  });

  it("rejects an envelope that didn't complete", async () => {
    await expect(evaluate(fakeAi({ state: "Failed" }), {}, QUESTIONS)).rejects.toThrow(JevError);
  });
});
