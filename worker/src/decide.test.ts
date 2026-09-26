import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { z } from "zod";
import type { DecideRequest, SessionResponse } from "../../shared/types";
import app, { MAX_BODY_BYTES } from "./index";
import { evaluate, JevError } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { SESSION_COOKIE, signSession, verifySession } from "./session";
import { DecideRequestSchema, parseDecideRequest } from "./validate";

const valid: DecideRequest = { caption: "A red stop sign against a blue sky", zone: "near_sidewalk" };

describe("parseDecideRequest", () => {
  it("produces exactly the shared DecideRequest type", () => {
    // Fails `pnpm typecheck` if the schema and the shared contract drift apart.
    expectTypeOf<z.output<typeof DecideRequestSchema>>().toEqualTypeOf<DecideRequest>();
  });

  it("accepts a valid request", () => {
    expect(parseDecideRequest(valid)).toEqual({ ok: true, value: valid });
  });

  it.each([
    ["unknown fields", { ...valid, questions: {} }],
    // Distance and speed stay in the game; Jev only gets the zone.
    ["the old distance and speed fields", { ...valid, distance: "far", speedKmh: 50 }],
    ["an unknown zone", { ...valid, zone: "road" }],
    ["a missing zone", { caption: valid.caption }],
    ["an empty caption", { ...valid, caption: "  \n " }],
    ["a caption over 300 chars", { ...valid, caption: "a".repeat(301) }],
    ["a non-string caption", { caption: 42 }],
    ["a missing caption", { zone: "own_lane" }],
    // The Turnstile token goes to /api/session now.
    ["a turnstileToken", { ...valid, turnstileToken: "t" }],
    ["an array", [valid]],
    ["null", null],
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
  it("gives Jev the caption and the zone in words", () => {
    expect(buildState({ caption: "a dog", zone: "far_sidewalk" })).toEqual({
      object_seen: "a dog",
      location: "on the sidewalk across the road, beyond the oncoming lane, not on the road",
    });
  });
});

const jevBody = {
  model: "jev-1.13.0",
  answers: {
    action: { type: "choice", choice: "slow_down", confidence: 0.6, probabilities: { slow_down: 0.6, stop: 0.3 } },
    category: { type: "choice", choice: "person", confidence: 0.7, probabilities: { person: 0.8, obstacle: 0.2 } },
    speed_limit: { type: "choice", choice: "none", confidence: 0.99, probabilities: { none: 0.99 } },
  },
  usage: { input_tokens: 1044, output_tokens: 264 },
};

const fakeAi = (response: unknown) => ({ run: vi.fn(() => Promise.resolve(response)) }) as unknown as Ai;

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
    expect(res.action).toMatchObject({ choice: "slow_down", confidence: 0.6 });
    expect(res.action.probabilities).toMatchObject({ slow_down: 0.6, stop: 0.3, continue: 0, go: 0 });
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
    delete bad.answers.action;
    await expect(evaluate(fakeAi(bad), {}, QUESTIONS)).rejects.toThrow(JevError);
  });

  it("rejects an envelope that didn't complete", async () => {
    await expect(evaluate(fakeAi({ state: "Failed" }), {}, QUESTIONS)).rejects.toThrow(JevError);
  });
});

describe("POST /api/decide", () => {
  const post = async (
    body: string,
    ai: unknown = fakeAi(jevBody),
    contentType = "application/json",
    env: Partial<Env> = {},
  ) => {
    const cookie = `${SESSION_COOKIE}=${await signSession(SECRET, Date.now() + 60_000)}`;
    return app.request(
      "/api/decide",
      { method: "POST", headers: { "content-type": contentType, cookie }, body },
      testEnv({ AI: ai as Ai, ...env }),
    );
  };

  it("answers a valid request", async () => {
    const res = await post(JSON.stringify(valid));
    expect(res.status).toBe(200);
    expect(res.headers.get("server-timing")).toMatch(/^jev;dur=\d+/);
    expect(await res.json()).toMatchObject({
      action: { choice: "slow_down" },
      category: { choice: "person" },
    });
  });

  it("accepts the largest valid request", async () => {
    const body = JSON.stringify({ ...valid, caption: "\u0001".repeat(299) + "a" });
    expect(body.length).toBeGreaterThan(1800);
    expect((await post(body)).status).toBe(200);
  });

  it("rejects a request without a valid session with 401, before asking Jev", async () => {
    const run = vi.fn();
    const expired = `${SESSION_COOKIE}=${await signSession(SECRET, Date.now() - 1)}`;
    const forged = `${SESSION_COOKIE}=${await signSession("another secret", Date.now() + 60_000)}`;
    for (const cookie of [undefined, expired, forged, `${SESSION_COOKIE}=v1.9999999999999.x`]) {
      const headers: Record<string, string> = { "content-type": "application/json", ...(cookie && { cookie }) };
      const res = await app.request(
        "/api/decide",
        { method: "POST", headers, body: JSON.stringify(valid) },
        testEnv({ AI: { run } as unknown as Ai }),
      );
      expect(res.status).toBe(401);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects with 429 when the rate limit is hit, before asking Jev", async () => {
    const run = vi.fn();
    const res = await post(JSON.stringify(valid), { run }, "application/json", { DECIDE_LIMITER: limiter(false) });
    expect(res.status).toBe(429);
    expect(run).not.toHaveBeenCalled();
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
    expect((await app.request("/api/nope", {}, testEnv())).status).toBe(404);
    expect((await app.request("/api/decide", {}, testEnv())).status).toBe(404);
  });
});

describe("POST /api/session", () => {
  const post = (body: unknown, env: Partial<Env> = {}) =>
    app.request(
      "https://drive.example/api/session",
      {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
        body: JSON.stringify(body),
      },
      testEnv(env),
    );
  const siteverify = (answer: unknown, status = 200) =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(answer), { status }));

  afterEach(() => vi.restoreAllMocks());

  it("sets a session cookie that /api/decide accepts", async () => {
    const fetchSpy = siteverify({ success: true });
    const res = await post({ turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(res.status).toBe(200);
    const { expiresAt } = await res.json<SessionResponse>();
    expect(expiresAt).toBeGreaterThan(Date.now());

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(JSON.parse(init!.body as string)).toEqual({
      secret: "turnstile secret",
      response: "XXXX.DUMMY.TOKEN.XXXX",
      remoteip: "203.0.113.7",
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const cookie = setCookie.split(";")[0]!;
    const decide = await app.request(
      "/api/decide",
      { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(valid) },
      testEnv(),
    );
    expect(decide.status).toBe(200);
  });

  it("rejects a token Turnstile refuses with 403", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    const res = await post({ turnstileToken: "used" });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns 502 when Turnstile is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    siteverify({}, 500);
    expect((await post({ turnstileToken: "t" })).status).toBe(502);
  });

  it.each([
    ["a missing token", {}],
    ["an empty token", { turnstileToken: "" }],
    ["a token over 2048 chars", { turnstileToken: "t".repeat(2049) }],
    ["unknown fields", { turnstileToken: "t", caption: "x" }],
  ])("rejects %s with 400, without asking Turnstile", async (_, body) => {
    const fetchSpy = siteverify({ success: true });
    expect((await post(body)).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects with 429 when the rate limit is hit", async () => {
    const fetchSpy = siteverify({ success: true });
    expect((await post({ turnstileToken: "t" }, { SESSION_LIMITER: limiter(false) })).status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sessions", () => {
  it("round-trips and expires", async () => {
    const now = Date.now();
    const value = await signSession(SECRET, now + 1000);
    expect(await verifySession(SECRET, value, now)).toBe(true);
    expect(await verifySession(SECRET, value, now + 1000)).toBe(false);
    expect(await verifySession("other", value, now)).toBe(false);
  });

  it("rejects a changed expiry", async () => {
    const now = Date.now();
    const value = await signSession(SECRET, now + 1000);
    const extended = value.replace(String(now + 1000), String(now + 10_000_000));
    expect(await verifySession(SECRET, extended, now)).toBe(false);
  });
});

const SECRET = "session secret";

function limiter(success = true): RateLimit {
  return { limit: vi.fn(() => Promise.resolve({ success })) };
}

function testEnv(env: Partial<Env> = {}): Env {
  return {
    AI: fakeAi(jevBody),
    DECIDE_LIMITER: limiter(),
    SESSION_LIMITER: limiter(),
    TURNSTILE_SECRET_KEY: "turnstile secret",
    SESSION_SECRET: SECRET,
    ...env,
  };
}
