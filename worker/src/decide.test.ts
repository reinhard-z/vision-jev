import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import type { DecideRequest } from "../../shared/types";
import app, { MAX_BODY_BYTES } from "./index";
import { evaluate, JevError } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { DecideRequestSchema, parseDecideRequest } from "./validate";

const valid: DecideRequest = { caption: "A red stop sign against a blue sky" };

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
    // Where the object is stays in the game; Jev only classifies the caption.
    ["the old zone, distance and speed fields", { ...valid, zone: "road", distance: "far", speedKmh: 50 }],
    ["an empty caption", { ...valid, caption: "  \n " }],
    ["a caption over 300 chars", { ...valid, caption: "a".repeat(301) }],
    ["a non-string caption", { caption: 42 }],
    ["a missing caption", { turnstileToken: "t" }],
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

  it.each([
    ["tabs and CRLF", "a\tdog\r\nhere", "a dog here"],
    ["C1 controls and DEL", "a\u0085dog\u009b\u007fhere", "a dog here"],
    ["Unicode line and paragraph separators", "a dog here", "a dog here"],
    ["non-breaking and wide spaces", "a  dog　here", "a dog here"],
    ["emoji and accents, untouched", "  a 🐕 in the café  ", "a 🐕 in the café"],
  ])("flattens %s", (_, caption, expected) => {
    const r = parseDecideRequest({ ...valid, caption });
    expect(r.ok && r.value.caption).toBe(expected);
  });
});

describe("buildState", () => {
  it("gives Jev only the caption", () => {
    expect(buildState({ caption: "a dog", turnstileToken: "t" })).toEqual({ object_seen: "a dog" });
  });
});

const jevBody = {
  model: "jev-1.13.0",
  answers: {
    category: { type: "choice", choice: "person", confidence: 0.7, probabilities: { person: 0.8, obstacle: 0.2 } },
    light_state: { type: "choice", choice: "not_a_light", confidence: 0.99, probabilities: { not_a_light: 1 } },
    speed_limit: { type: "choice", choice: "none", confidence: 0.99, probabilities: { none: 0.99 } },
    could_be_person: { type: "noul", noul: 0.92 },
    mentions_child: { type: "noul", noul: 0.97 },
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
    expect(res.category).toMatchObject({ choice: "person", confidence: 0.7 });
    expect(res.category.probabilities).toMatchObject({ person: 0.8, obstacle: 0.2, animal: 0, unclear: 0 });
    expect(res.couldBePerson).toBe(0.92);
    expect(res.mentionsChild).toBe(0.97);
    expect(res).not.toHaveProperty("action");
  });

  it("accepts the documented unwrapped body", async () => {
    const result = await evaluate(fakeAi(jevBody), {}, QUESTIONS);
    expect(result.model).toBe("jev-1.13.0");
  });

  it("rejects a choice outside the criteria", async () => {
    const bad = structuredClone(jevBody);
    bad.answers.category.choice = "ghost";
    await expect(evaluate(fakeAi(bad), {}, QUESTIONS)).rejects.toThrow(JevError);
  });

  it("rejects a missing answer", async () => {
    const bad = structuredClone(jevBody) as { answers: Record<string, unknown> };
    delete bad.answers.mentions_child;
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
    expect(await res.json()).toMatchObject({
      category: { choice: "person" },
      couldBePerson: 0.92,
      mentionsChild: 0.97,
    });
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
