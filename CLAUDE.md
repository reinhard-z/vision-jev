# Jev Driver

A browser demo: a car drives along a top-down scrolling road. The user drags images onto the road or the sidewalk. A small vision model in the browser captions each image, a Cloudflare Worker asks Jev (TypeSafe's decision model) what the car should do, and the car reacts.

- Full spec and stage plan: `docs/SPEC.md`. Read the relevant section before starting a stage.
- Jev API reference: `docs/jev.md`.

## Stack

- Frontend: Vite + React + TypeScript (strict mode). React for the UI (thoughts panel, sample tray, drop zones, loading states); the road and car are drawn on a Canvas 2D element.
- Vision: Transformers.js, running in a Web Worker (WebGPU with Wasm fallback).
- Backend: one Cloudflare Worker (Hono) that serves the static frontend and `POST /api/decide`.
- Jev: Cloudflare Workers AI binding (`env.AI`), model `typesafe/jev`.

## Commands

<!-- Fill in once the project is scaffolded -->

- Dev: `pnpm dev` (Vite + Worker in workerd via `@cloudflare/vite-plugin`)
- Build: `pnpm build` (type check + Vite build of client and Worker)
- Check: `pnpm typecheck`, `pnpm lint`, `pnpm test` (Vitest, headless engine tests)
- Deploy: `pnpm deploy`
- Worker types: `pnpm cf-typegen` regenerates `worker-configuration.d.ts`; rerun it after changing `wrangler.jsonc`.
- Package manager: pnpm. TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7 yet.

## Rules

- Jev was released in September 2026, after your training data. Never guess its API. Use `docs/jev.md`; if something isn't covered there, fetch the Cloudflare docs page linked in it instead of inventing fields.
- All Jev calls go through a single function in `worker/src/jev.ts`. Nothing else touches the AI binding. This keeps the provider swappable.
- No API keys or secrets in frontend code, ever. The frontend only calls `/api/decide`.
- `/api/decide` accepts only the fields defined in the spec, validates them, and rejects anything else. The Jev questions and policy live on the server, never in the request.
- Do arithmetic in code, not in Jev: distances, stopping, speeds, timers. Jev gets pre-computed descriptions like "far ahead".
- Keep the vision model off the main thread so the game loop never freezes.
- The game loop runs in `requestAnimationFrame` with its state in a ref or a plain module, not in React state. React re-renders only for UI changes (new decisions, loading progress), never once per frame.
- Share request/response types between frontend and Worker from one file (e.g. `shared/types.ts`) so the API contract can't drift.
- Model weights load from Hugging Face with a pinned revision. Never commit weights to this repo or serve them from the Worker.
- Work stage by stage as defined in `docs/SPEC.md`: plan first, then implement, then run it and verify. When a stage works, tick it off in the spec and note any decisions that changed.
- Commit after each working step with a clear message.
