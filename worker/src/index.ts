import { Hono } from "hono";

// Static assets are served by Workers Assets; only /api/* reaches this app.
const app = new Hono();

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
