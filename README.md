# Jev Driver

[![CI](https://github.com/reinhard-z/vision-jev/actions/workflows/ci.yml/badge.svg)](https://github.com/reinhard-z/vision-jev/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/reinhard-z/vision-jev)](LICENSE)
[![Mentioned in Awesome Jev](https://awesome.re/mentioned-badge.svg)](https://github.com/yibie/awesome-jev)

Listed in [awesome-jev](https://github.com/yibie/awesome-jev) ![stars](https://img.shields.io/github/stars/yibie/awesome-jev?style=flat-square&label=%E2%98%85) and [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev) ![stars](https://img.shields.io/github/stars/AbdelStark/awesome-typesafe-jev?style=flat-square&label=%E2%98%85)

**Can Jev drive a car?** An experiment with [Jev](https://developers.cloudflare.com/ai/models/typesafe/jev/), a fast classification model from TypeSafe, to see what it can do when decisions have to happen in real time.

I built a browser game where it drives a car. You drag images of pedestrians, obstacles or traffic signs onto the road. A vision model in your browser writes a short caption for each image, and Jev uses that caption and the object's location to decide whether to stop, slow down or keep going.

In the tuning run, Jev answered in about **330 ms (median)** and made the expected call in **151 of 156 scored scenarios**, at an estimated cost of **$0.00004 per decision**. You can see how sure it was about each choice in the Thoughts panel, and it does get some wrong. See [the test results](#what-the-tests-showed) for the details.

**[Try it at drive.mrza.ch](https://drive.mrza.ch)**

https://github.com/user-attachments/assets/635437a8-d4f1-4d02-883b-53b56ef28bb2

## Try it

Open the demo in a browser with WebGPU and wait for the vision model to load. The first visit downloads about 357 MB; the browser caches the weights afterward. A CPU fallback is available (228 MB), but captioning is much slower and the car may react too late.

- Drag a sample photo or your own image into either lane or onto either sidewalk.
- Move an object to ask Jev again. Drag it off the road or click its × to remove it.
- Adjust the speed slider to give the car more—or less—time to react.

Try a child beside the road, a teddy bear in your lane, or a traffic light on the opposite sidewalk. Add `?debug` to the URL to inspect the captions and request timing.

## How it works

```text
image → Florence-2 in the browser → caption
caption + location → Cloudflare Worker → Jev → driving action
```

Florence-2 runs in a Web Worker through Transformers.js. Images stay in the browser; only the caption and location are sent to the server. Jev chooses an action such as `stop`, `slow_down`, `wait_for_green` or `change_speed`. The game handles movement, braking and timers in code, with no rule table overriding Jev's answer.

If captioning or the decision request fails, the game stops for objects in your lane, slows down for the oncoming lane and continues past the sidewalks.

## What the tests showed

The saved Jev tuning run tested **40 captions across four locations**, using sample-image captions, variants and hand-written edge cases.

| Measurement                              | Recorded result                                |
| ---------------------------------------- | ---------------------------------------------- |
| Jev actions matching the reference       | **151 / 156 scored cases (96.8%)**             |
| Jev call time, measured in the Worker    | **330 ms median · 421 ms p95**, over 160 calls |
| Browser captioning, Florence-2 at 384 px | **About 0.4 s** on an M1 with WebGPU           |

The action score measures agreement with hand-written acceptable answers on the same cases used to tune the policy. Four exploratory prompt-injection cases had no reference answer and are excluded from the score. These measurements cover separate stages of the pipeline; they do not measure total reaction time or end-to-end driving accuracy.

The mistakes are part of the experiment: Jev chose to continue for a teddy bear (two caption variants) and empty cardboard boxes in its lane, ignored an amber light in the oncoming lane, and slowed for a person on the far sidewalk where the reference expected it to continue. Some are debatable; the demo lets you inspect the decision either way.

Vision has its own limits: Florence-2 sometimes invents extra people or objects and can miss a traffic light's colour or a speed-limit number. Jev only gets the caption, so those errors carry through.

See the [saved Jev results](docs/jev-tuning/results.json), [reference actions and tuning script](scripts/tune-policy.ts), and [vision model comparison](docs/vision-models.md) for the data and test conditions.

## Run locally

You need Node 22.18+ in the Node 22 release line (see `.nvmrc`), pnpm 11 (exact version in `package.json`), and a Cloudflare account with Workers AI and prepaid AI Gateway credits. The dev server calls real Jev: the recorded cost estimate is about $0.00004 per decision. Without credits, calls fail with `2021: Insufficient AI Gateway credits`.

```sh
pnpm install
pnpm wrangler login
# Local Turnstile test secret and a random session key
printf 'TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\nSESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
pnpm dev
```

Open `http://localhost:5173`. Vite runs the frontend and Cloudflare Worker together.

| Command             | What it does                                                    |
| ------------------- | --------------------------------------------------------------- |
| `pnpm dev`          | Start the local app and Worker                                  |
| `pnpm build`        | Type-check and build                                            |
| `pnpm test`         | Run game engine, pipeline and Worker tests                      |
| `pnpm typecheck`    | Check TypeScript types                                          |
| `pnpm lint`         | Run ESLint                                                      |
| `pnpm format:check` | Check formatting                                                |
| `pnpm tune`         | Rerun the caption cases against the dev server (paid Jev calls) |

## Further reading

- [Deployment guide](docs/deployment.md): CI, secrets, previews, smoke checks and rollback.
- [Project spec and decisions log](docs/SPEC.md): game behavior, architecture and tuning history.
- [Vision model comparison](docs/vision-models.md): captions, performance and why Florence-2 was chosen.
- [Jev reference](docs/jev.md): request format, response format and billing notes.

## Credits and license

Code is [MIT licensed](LICENSE). Sample photos are from Wikimedia Commons and retain their own licenses; see [image credits](public/samples/CREDITS.md), also available in the app.
