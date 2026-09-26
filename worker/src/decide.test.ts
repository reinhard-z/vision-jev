import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import type { DecideRequest } from "../../shared/types";
import app, { MAX_BODY_BYTES } from "./index";
import { evaluate, JevError } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { DecideRequestSchema, parseDecideRequest } from "./validate";

const valid: DecideRequest = {
  caption: "A red stop sign against a blue sky",
  zone: "road",
  distance: "far",
  speedKmh: 50,
};

describe("parseDecideRequest", () => {
  it("produces exactly the shared DecideRequest type", () => {
    // Fails `pnpm typecheck` if the schema and the shared contract drift apart.
    expectTypeOf<z.output<typeof DecideRequestSchema>>().toEqualTypeOf<DecideRequest>();
  });

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
    ["a turnstileToken over 2048 chars", { ...valid, turnstileToken: "t".repeat(2049) }],
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
      buildState(valid),
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

describe("POST /api/decide", () => {
  const post = (body: string, ai: unknown = fakeAi(jevBody), contentType = "application/json") =>
    app.request("/api/decide", { method: "POST", headers: { "content-type": contentType }, body }, { AI: ai as Ai });

  it("answers a valid request", async () => {
    const res = await post(JSON.stringify(valid));
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(/^jev;dur=\d+/);
    expect(await res.json()).toMatchObject({ action: { choice: "stop" }, couldBePerson: 0.92 });
  });

  it("accepts the largest valid request", async () => {
    const body = JSON.stringify({ ...valid, caption: "\u0001".repeat(299) + "a", turnstileToken: "t".repeat(2048) });
    expect(body.length).toBeGreaterThan(2048);
    expect((await post(body)).status).toBe(200);
  });

  it("rejects a body over the limit with 413", async () => {
    expect((await post("x".repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
  });

  it("rejects a non-JSON content type with 415", async () => {
    expect((await post(JSON.stringify(valid), fakeAi(jevBody), "text/plain")).status).toBe(415);
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("rejects an invalid request with 400 and a short reason", async () => {
    const res = await post(JSON.stringify({ ...valid, questions: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining("questions") as unknown });
  });

  it("returns 502 when Jev fails, without leaking the cause", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(JSON.stringify(valid), fakeAi({ state: "Failed", secret: "internal" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "decision failed" });
    spy.mockRestore();
  });

  it("returns 404 for unknown API routes and methods", async () => {
    expect((await app.request("/api/nope", {}, { AI: fakeAi(jevBody) })).status).toBe(404);
    expect((await app.request("/api/decide", {}, { AI: fakeAi(jevBody) })).status).toBe(404);
  });
});
