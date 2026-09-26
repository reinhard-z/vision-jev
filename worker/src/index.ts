import { Hono } from "hono";
import { evaluate } from "./jev";
import { buildState, QUESTIONS, toDecideResponse } from "./policy";
import { parseDecideRequest } from "./validate";

const MAX_BODY_CHARS = 2048;

// Static assets are served by Workers Assets; only /api/* reaches this app.
const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/decide", async (c) => {
  const started = Date.now();
  if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: "expected JSON" }, 415);
  const text = await c.req.text();
  if (text.length > MAX_BODY_CHARS) return c.json({ error: "body too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = parseDecideRequest(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  try {
    const result = await evaluate(c.env.AI, buildState(parsed.value), QUESTIONS);
    const response = toDecideResponse(result);
    console.log(
      JSON.stringify({ event: "decide", model: result.model, jevMs: result.latencyMs, inputTokens: result.inputTokens }),
    );
    c.header("Server-Timing", `jev;dur=${result.latencyMs}, total;dur=${Date.now() - started}`);
    return c.json(response);
  } catch (err) {
    console.error("decide failed", err);
    return c.json({ error: "decision failed" }, 502);
  }
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
