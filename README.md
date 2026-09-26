# Jev Driver

**Live: [drive.mrza.ch](https://drive.mrza.ch)**

A browser toy: a car drives along a top-down scrolling road, and you drop images into its lane, the oncoming lane or onto either sidewalk. A small vision model in the browser describes each image, [Jev](docs/jev.md) (TypeSafe's decision model, on Cloudflare Workers AI) decides what the car should do given that caption and where the object is, and the game carries it out. The thoughts panel shows why the car did what it did, especially when it gets it wrong.

This is a demo of a "System One" split, not a model of real autonomous driving.

## How it works

```
image ─▶ Florence-2 (Web Worker, in the browser) ─▶ caption
caption + zone ─▶ POST /api/decide (Cloudflare Worker) ─▶ Jev ─▶ action
action ─▶ game: brake, slow down, wait, change speed…
```

- **Vision:** Florence-2 base via Transformers.js, off the main thread, WebGPU with a Wasm fallback. Weights load from Hugging Face at a pinned revision and are cached by the browser (~357 MB on WebGPU, ~228 MB on Wasm, first load only).
- **Decision:** the Worker sends Jev the caption and the zone in words and asks for an action (`continue`, `slow_down`, `stop`, `stop_then_go`, `wait_for_green`, `go`, `change_speed`), a category and a speed limit. Jev's answer drives the car; there's no rule table overriding it.
- **Game:** distances, braking, speeds and timers are plain code in a `requestAnimationFrame` loop drawn on a canvas. Only when there's no answer (no caption, or the request failed) does the game decide on its own.

The full spec, stage plan and decisions log are in [docs/SPEC.md](docs/SPEC.md).

## Running it locally

Requirements:

- Node 22 (see `.nvmrc`) and pnpm 11
- A Cloudflare account with Workers AI. Jev is billed from prepaid AI Gateway credits, so the account needs some; without them calls fail with `2021: Insufficient AI Gateway credits`. One decision costs about $0.00004.
- A browser with WebGPU for fast captions (Wasm works, but a caption takes ~15 s instead of ~0.4 s)

```sh
pnpm install
pnpm wrangler login   # the AI binding calls Cloudflare even in dev
# Local secrets: Cloudflare's Turnstile test secret (always passes) and any random session key
printf 'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
pnpm dev              # http://localhost:5173
```

`pnpm dev` runs Vite and the Worker (in workerd, via `@cloudflare/vite-plugin`) together.

Drag an image from the sample tray, or your own file, onto the road. Drag a placed object to move it (Jev is asked again), and drag it off the road or click its × to remove it. Add `?debug` to the URL to see each caption and the browser round-trip time.

## Commands

| Command             | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `pnpm dev`          | Dev server with the Worker                                          |
| `pnpm build`        | Type check, then build client and Worker                            |
| `pnpm test`         | Vitest: game engine, pipeline and Worker tests                      |
| `pnpm typecheck`    | `tsc -b`                                                            |
| `pnpm lint`         | ESLint                                                              |
| `pnpm format:check` | Prettier                                                            |
| `pnpm tune`         | Run the tuning captions through a running `/api/decide` (real Jev calls) |
| `pnpm cf-typegen`   | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
| `pnpm deploy`       | Build and deploy with Wrangler to drive.mrza.ch                     |

## Project layout

```
src/
  game/          engine, physics, rendering, behaviors (Jev's action → game behavior)
  perception/    vision Web Worker and model code
  components/    React UI: road canvas, thoughts panel, sample tray
  api/           clients for /api/session (Turnstile) and /api/decide
worker/src/
  index.ts       Hono app: POST /api/session and /api/decide, rate limits
  session.ts     signed session cookies
  turnstile.ts   Turnstile token check
  validate.ts    strict request validation (Zod)
  policy.ts      the questions and state sent to Jev
  jev.ts         the only code that calls the AI binding
shared/types.ts  request/response types shared by client and Worker
public/samples/  sample images (credits in CREDITS.md)
docs/            spec, Jev reference, vision model comparison, tuning data
```

## Status

All stages are done: game, in-browser vision, Jev decisions, lanes and sidewalks, and the hardened deploy (Turnstile session, per-IP rate limits). See [docs/SPEC.md](docs/SPEC.md#stages).

## Deploying

The Worker needs two secrets, set once:

```sh
pnpm wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget for drive.mrza.ch
pnpm wrangler secret put SESSION_SECRET         # any random string, e.g. openssl rand -hex 32
pnpm deploy
```

Changing `SESSION_SECRET` logs everyone out; the page opens a new session on its own.

## Credits

Sample photos are from Wikimedia Commons; sources and licenses are in [public/samples/CREDITS.md](public/samples/CREDITS.md) and in the app's "Image credits" dialog.
