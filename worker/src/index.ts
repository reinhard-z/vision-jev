import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { evaluate } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { parseDecideRequest } from "./validate";

// Fits the largest valid request (2048-char Turnstile token plus a 300-char
// caption, even fully \u-escaped) with room to spare. Checked against
// Content-Length first, then while reading the body.
export const MAX_BODY_BYTES = 8 * 1024;

// Static assets are served by Workers Assets; only /api/* reaches this app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.post(
  "/api/decide",
  bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "body too large" }, 413) }),
  async (c) => {
    const started = Date.now();
    if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "expected JSON" }, 415);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const parsed = parseDecideRequest(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

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
  },
);

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
