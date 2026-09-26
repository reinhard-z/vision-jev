# Jev Driver

**Live: [drive.mrza.ch](https://drive.mrza.ch)**

**Can Jev drive a car?** This demo puts it behind the wheel: drop images of pedestrians, obstacles and traffic signs along the road and let Jev decide whether to stop, slow down or keep going.

[Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/) is TypeSafe's model for fast, low-cost classification and structured decisions. You give it a situation and questions with defined choices; it returns answers with probabilities and confidence. In this project, a Jev call takes around 330 ms at the median in our tuning run and costs roughly $0.00004 per decision—about 25,000 decisions for a dollar. See the [measurements](docs/SPEC.md) and [Jev reference](docs/jev.md) for details.

A vision model running in the browser describes each image. Jev receives the caption and the object's location through Cloudflare Workers AI, and its chosen action drives the car. The Thoughts panel shows the action probabilities and resulting behavior, including the wrong decisions.

![Jev Driver demo showing images placed along the road and Jev's action probabilities in the Thoughts panel](docs/assets/jev-driver-demo.gif)

This is a demo of a "System One" split, not a model of real autonomous driving.

## Try it

Open [drive.mrza.ch](https://drive.mrza.ch) and wait for the vision model to load. The first visit downloads about 357 MB with WebGPU or 228 MB with Wasm; the browser caches the weights for later visits. WebGPU is recommended: the CPU fallback is much slower, so decisions can arrive too late for the car to react.

Drag a sample image or your own image file into the car's lane, the oncoming lane or onto either sidewalk. Move a placed object to ask Jev again, and drag it off the road or click its × to remove it. Use the speed slider to adjust the target speed.

Add `?debug` to the URL to inspect each caption and the browser round-trip time.

## How it works

```
image ─▶ Florence-2 (Web Worker, in the browser) ─▶ caption
caption + zone ─▶ POST /api/decide (Cloudflare Worker) ─▶ Jev ─▶ action
action ─▶ game: brake, slow down, wait, change speed…
```

- **Vision:** Florence-2 base via Transformers.js, off the main thread, WebGPU with a Wasm fallback. Weights load from Hugging Face at a pinned revision and are cached by the browser (~357 MB on WebGPU, ~228 MB on Wasm, first load only).
- **Decision:** the Worker sends Jev the caption and the zone in words and asks for an action (`continue`, `slow_down`, `stop`, `stop_then_go`, `wait_for_green`, `go`, `change_speed`), a category and a speed limit. Jev's answer drives the car; there's no rule table overriding it.
- **Game:** distances, braking, speeds and timers are plain code in a `requestAnimationFrame` loop drawn on a canvas. If captioning or the decision request fails, the fallback is to stop for objects in the car's lane, slow down for those in the oncoming lane and continue past those on the sidewalks.

Images are captioned locally. The decision request sends the caption and zone to the Worker, which passes them to Jev; it does not send the image.

The full spec, stage plan and decisions log are in [docs/SPEC.md](docs/SPEC.md).

## Running it locally

Requirements:

- Node 22.18 or newer in the Node 22 release line (see `.nvmrc`) and pnpm 11 (the exact version is pinned in `package.json`)
- A Cloudflare account with Workers AI. Jev is billed from prepaid AI Gateway credits, so the account needs some; without them calls fail with `2021: Insufficient AI Gateway credits`. One decision costs about $0.00004.
- A browser with WebGPU for fast captions. Local M1 measurements were about 0.4 s per caption at the current 384 px resolution; the Wasm benchmark was about 15 s at 768 px. See [the vision model comparison](docs/vision-models.md) for test conditions.

```sh
pnpm install
pnpm wrangler login   # the AI binding calls Cloudflare even in dev
# Local secrets: Cloudflare's Turnstile test secret (always passes) and any random session key
printf 'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
pnpm dev              # http://localhost:5173
```

`pnpm dev` runs Vite and the Worker (in workerd, via `@cloudflare/vite-plugin`) together.

## Commands

| Command               | What it does                                                             |
| --------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`            | Dev server with the Worker                                               |
| `pnpm build`          | Type check, then build client and Worker                                 |
| `pnpm preview`        | Build and preview locally                                                |
| `pnpm preview:remote` | Build and upload a remote preview (see limitations below)                |
| `pnpm test`           | Vitest: game engine, pipeline and Worker tests                           |
| `pnpm typecheck`      | `tsc -b`                                                                 |
| `pnpm lint`           | ESLint                                                                   |
| `pnpm format:check`   | Prettier                                                                 |
| `pnpm tune`           | Run the tuning captions through a running `/api/decide` (real Jev calls) |
| `pnpm cf-typegen`     | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc`   |
| `pnpm deploy`         | Build and deploy with Wrangler to drive.mrza.ch                          |
| `pnpm smoke [url]`    | Check health and session enforcement; defaults to the live site          |

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
docs/            spec, Jev reference, vision model comparison, tuning data, demo GIF
```

## Status

All stages are done: game, in-browser vision, Jev decisions, lanes and sidewalks, and the hardened deploy (Turnstile session, per-IP rate limits). See [docs/SPEC.md](docs/SPEC.md#stages).

## Deploying

Pushing directly to `main` deploys to https://drive.mrza.ch; no PR is required. The `deploy` job in [.github/workflows/ci.yml](.github/workflows/ci.yml) runs after the checks pass: it builds, runs `wrangler deploy` (tagged with the commit), then smoke-checks the live site with `pnpm smoke`. Each endpoint gets up to a minute of retries: GET `/api/health` must answer 200, and POST `/api/decide` with valid JSON and no cookie must answer 401. A failed smoke check fails the job; it does not automatically roll back. Deploys run one at a time and a running one is never cancelled. GitHub keeps only the newest pending run when several pushes arrive during a run.

### One-time setup

The Custom Domain route for `drive.mrza.ch` is already in `wrangler.jsonc`. Both Worker secrets are already set in Cloudflare; leave them there. For a fresh Worker only, set them with these commands (they never go to GitHub):

```sh
pnpm wrangler secret put TURNSTILE_SECRET_KEY   # from the Turnstile widget for drive.mrza.ch
pnpm wrangler secret put SESSION_SECRET   # any random string, e.g. openssl rand -hex 32
```

[`secrets.required`](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets) in `wrangler.jsonc` lists both names, so CI generates the same types without `.dev.vars`, and a deploy fails if one is missing. Changing `SESSION_SECRET` logs everyone out; the page opens a new session on its own.

Cloudflare, an API token for GitHub: My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, limited to this account and the `mrza.ch` zone.

GitHub, Settings → Environments → New environment `production`:

- Deployment branches: selected branches, `main` only.
- Environment secret `CLOUDFLARE_API_TOKEN`: the token above.
- Environment variable `CLOUDFLARE_ACCOUNT_ID`: from `pnpm wrangler whoami`.

Leave required reviewers and wait timers disabled for automatic deployment. Use GitHub Actions as the deployment trigger; disable any separate Cloudflare Workers Builds Git integration to avoid duplicate deploys.

`pnpm deploy` still deploys from your machine, with your own `wrangler login`.

### Remote previews

```sh
pnpm preview:remote
```

This builds the current working tree, then runs `wrangler versions upload --preview-alias preview`. Wrangler reads Vite's redirected config at `dist/jev_driver/wrangler.json`, uploads the Worker and assets, and prints the version URL and the stable alias `https://preview-jev-driver.<account-subdomain>.workers.dev`. It does not send production traffic to the uploaded version. The next preview upload moves the alias to that version.

[`preview_urls: true`](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) enables these public URLs. The account needs a Workers subdomain configured in Cloudflare. Authenticate locally with `pnpm wrangler login`, or use `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Version URLs share the Worker's resources and secrets; they are not isolated environments.

The Turnstile widget currently allows only `drive.mrza.ch`. The page loads on a preview URL, but the challenge fails and decisions cannot run until that hostname is added to the widget's allowed domains. The preview command does not change the widget. Allowing the stable alias hostname would cover future uploads using that alias; individual version URLs have different hostnames.

### Rolling back

```sh
pnpm wrangler deployments list   # the 10 most recent deployments, with version IDs
pnpm wrangler rollback --message "why"   # back to the previous version
pnpm wrangler rollback <version-id> --message "why"   # or to a given one (last 100)
```

[`wrangler rollback`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback) immediately sends production traffic to the selected version. Follow any confirmation prompts from your installed Wrangler. Bound resources and their data are not rolled back; review any warning about changed secrets. Run `pnpm smoke` afterward. The next push to `main` deploys again, so revert the bad commit before pushing.

## Credits

Sample photos are from Wikimedia Commons; sources and licenses are in [public/samples/CREDITS.md](public/samples/CREDITS.md) and in the app's "Image credits" dialog.
