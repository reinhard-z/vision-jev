import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import type { SessionResponse } from "../../shared/types";
import { evaluate } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { SESSION_COOKIE, SESSION_TTL_MS, signSession, verifySession } from "./session";
import { verifyTurnstile } from "./turnstile";
import { parseDecideRequest, parseSessionRequest, type Parsed } from "./validate";

// Fits the largest valid request (a 2048-char Turnstile token, or a 300-char
// caption even fully \u-escaped) with room to spare. Checked against
// Content-Length first, then while reading the body.
export const MAX_BODY_BYTES = 8 * 1024;

type Ctx = Context<{ Bindings: Env }>;

// Static assets are served by Workers Assets; only /api/* reaches this app.
const app = new Hono<{ Bindings: Env }>();

const limitBody = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: "body too large" }, 413),
});

app.get("/api/health", (c) => c.json({ ok: true }));

// Trades a solved Turnstile challenge for a session cookie that /api/decide needs.
app.post("/api/session", limitBody, async (c) => {
  if (!(await withinLimit(c, c.env.SESSION_LIMITER))) return c.json({ error: "too many requests" }, 429);
  const parsed = await readJson(c, parseSessionRequest);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  let human: boolean;
  try {
    human = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, parsed.value.turnstileToken, clientIp(c));
  } catch (err) {
    console.error("turnstile failed", err);
    return c.json({ error: "verification unavailable" }, 502);
  }
  if (!human) return c.json({ error: "verification failed" }, 403);

  const expiresAt = Date.now() + SESSION_TTL_MS;
  setCookie(c, SESSION_COOKIE, await signSession(c.env.SESSION_SECRET, expiresAt), {
    path: "/api/",
    httpOnly: true,
    // Browsers accept Secure cookies from http://localhost, but not from other plain-HTTP hosts.
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ expiresAt } satisfies SessionResponse);
});

app.post("/api/decide", limitBody, async (c) => {
  const started = Date.now();
  if (!(await withinLimit(c, c.env.DECIDE_LIMITER))) return c.json({ error: "too many requests" }, 429);
  if (!(await verifySession(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE), started))) {
    return c.json({ error: "no session" }, 401);
  }
  const parsed = await readJson(c, parseDecideRequest);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);

  try {
    const result = await evaluate(c.env.AI, buildState(parsed.value), QUESTIONS);
    const response = toDecideResponse(result);
    console.log(
      JSON.stringify({
        event: "decide",
        model: result.model,
        jevMs: result.latencyMs,
        inputTokens: result.inputTokens,
      }),
    );
    c.header("Server-Timing", `jev;dur=${result.latencyMs}, total;dur=${Date.now() - started}`);
    return c.json(response);
  } catch (err) {
    console.error("decide failed", err);
    return c.json({ error: "decision failed" }, 502);
  }
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/** Cloudflare sets this header at the edge; clients can't forge it. */
function clientIp(c: Ctx): string | undefined {
  return c.req.header("cf-connecting-ip");
}

async function withinLimit(c: Ctx, limiter: RateLimit): Promise<boolean> {
  const { success } = await limiter.limit({ key: clientIp(c) ?? "unknown" });
  return success;
}

type ReadResult<T> = { ok: true; value: T } | { ok: false; error: string; status: 400 | 415 };

async function readJson<T>(c: Ctx, parse: (body: unknown) => Parsed<T>): Promise<ReadResult<T>> {
  if (!c.req.header("content-type")?.startsWith("application/json")) {
    return { ok: false, error: "expected JSON", status: 415 };
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: "invalid JSON", status: 400 };
  }
  const parsed = parse(body);
  return parsed.ok ? parsed : { ...parsed, status: 400 };
}

export default app;
