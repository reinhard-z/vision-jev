# Jev Driver – Spec

## Concept

A playful demo of a "System One" split: a small, fast vision model looks at an image and describes it, and Jev makes a quick, typed decision from that description. The user drops images next to or onto a road and watches a car react. The fun is in seeing _why_ the car did something, especially when it gets it wrong.

This is a toy, not a model of real autonomous driving.

## Gameplay

- Top-down view, road scrolls vertically, car stays near the bottom of the screen.
- Two drop zones: **road** (the car's lane) and **sidewalk** (next to the road).
- The user drags an image file (or picks from a tray of sample images) onto a zone. The image appears at that spot, some distance ahead of the car, and scrolls towards it.
- The drop position decides the location. The vision model only has to say _what_ the thing is.
- The car has a target speed (default 50 km/h) and accelerates/brakes smoothly towards it.

### Latency as a mechanic

- The car keeps moving while an image is being perceived and decided on. Show a "perceiving…" marker on the object.
- Distance to the object is computed in code and passed to Jev as a band: `far` (plenty of room to stop), `medium`, `near` (braking now is barely enough). Thresholds derive from current speed.
- If the car reaches an object before a decision arrives, count it as "reacted too late": flash the object, stop the car, show a message. Keep it non-graphic.

### Behaviors

Jev decides what kind of situation it is. Game code handles what happens over time.

| Situation                                        | Behavior (game code)                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| action `continue`                                | Keep target speed                                                                              |
| action `slow_down`                               | Reduce to 50% of target speed until the object is passed                                       |
| action `stop`                                    | Brake and stay stopped until the object is removed or dragged off the road                     |
| category `stop_sign`                             | Stop at the sign, wait 2 s, continue                                                           |
| category `traffic_light`, light `red` or `amber` | Stop at the light and wait until a green-light image is dropped, or the light image is removed |
| category `traffic_light`, light `green`          | Continue                                                                                       |
| category `speed_limit_sign`                      | Set target speed to the detected limit                                                         |

### Safety override (in code, not in Jev)

If the zone is `road` and `could_be_person` > 0.2, stop regardless of the chosen action. Show this in the thoughts panel as "safety override". This demonstrates preferring false alarms over missed hazards.

## Perception (browser)

- Transformers.js in a Web Worker. Load once, cache in the browser, show a progress bar on first load.
- Model: start with the smallest option that gives usable captions. Candidates to evaluate in stage 2: SmolVLM (256M/500M), Florence-2 base, Moondream. Verify current model IDs and Transformers.js support on Hugging Face before choosing; pin the revision.
- Aim for one or two sentences that name the main object, and for traffic lights, which lamp is lit. Some models take a task token rather than a free prompt (e.g. Florence-2); use whatever the model's docs specify.
- Trim captions to 300 characters before sending.

## Decision (Worker)

### `POST /api/decide`

Request (validated; anything else is rejected):

```json
{
  "caption": "a small child in a red jacket standing",
  "zone": "road",
  "distance": "far",
  "speedKmh": 50,
  "turnstileToken": "..."
}
```

- `caption`: string, 1–300 chars
- `zone`: `"road"` | `"sidewalk"`
- `distance`: `"far"` | `"medium"` | `"near"`
- `speedKmh`: integer 0–130
- `turnstileToken`: added in stage 4

Response:

```json
{
  "category": { "choice": "person", "confidence": 0.93, "probabilities": {} },
  "action": { "choice": "stop", "confidence": 0.9, "probabilities": {} },
  "lightState": { "choice": "not_a_light", "probabilities": {} },
  "speedLimit": { "choice": "none", "probabilities": {} },
  "couldBePerson": 0.97,
  "latencyMs": 180
}
```

### Jev state

Build readable descriptions in code rather than passing raw values, because Jev reads literally:

```json
{
  "object_seen": "<caption>",
  "location": "on the road, in the car's lane",
  "distance": "far ahead, plenty of room to stop",
  "car_speed": "50 km/h"
}
```

For the sidewalk: `"location": "on the sidewalk next to the road, not on the road"`.

### Jev questions (all in one call)

- `category` (choice): `person`, `animal`, `vehicle`, `traffic_light`, `stop_sign`, `speed_limit_sign`, `other_sign`, `obstacle`, `harmless_debris`, `unclear`
- `action` (choice), with the policy in the criteria:
  - `continue`: nothing on the road needs a reaction. Things on the sidewalk that are not entering the road.
  - `slow_down`: something could enter the road soon, or a minor obstacle is ahead.
  - `stop`: a person, animal, vehicle, or obstacle is on the road. If it is unclear whether something is a person, treat it as a person.
- `light_state` (choice): `red`, `amber`, `green`, `not_a_light`
- `speed_limit` (choice): `30`, `50`, `80`, `120`, `none`
- `could_be_person` (noul): could the object be a person or be mistaken for one?

Tune the wording by testing with the sample images, not by guessing.

## UI

Built with React + TypeScript. The road is a single `<canvas>` component that owns the game loop; everything around it is regular React components. The game loop reports events (object perceived, decision received, reacted too late) to React through a small event emitter or callback, not by setting state every frame.

- Thoughts panel beside the road, per object: thumbnail, caption, category, action with probability bars, confidence, override notice, latency (vision ms + Jev ms).
- Tray of sample images for quick testing, plus drag-and-drop of your own files.
- First-load progress bar for the vision model; note that images never leave the device, only the caption does.

## Abuse protection

- Strict validation and 300-char caption cap.
- Per-IP rate limiting (Cloudflare Workers rate limiting binding; check current docs).
- Cloudflare Turnstile token verified server-side before calling Jev.
- Spending: check Jev pricing for Workers AI in the Cloudflare dashboard and set up usage notifications.

## Hosting

- One Cloudflare Worker serving the static build plus `/api/decide`.
- Workers AI binding for Jev; no third-party API key.
- Model weights from Hugging Face (pinned revision). Mirror to R2 only if needed later.

## Stages

- [x] **1. Game with stub.** Road, car, zones, drag-and-drop, scrolling objects, behaviors, thoughts panel. `decide()` on the client returns a fixed fake answer after a fake delay.
- [ ] **2. Vision.** Transformers.js in a Web Worker, captions shown in the thoughts panel. Build `public/samples/` with test images: child, doll, dog, cat, adult, bicycle, car, stop sign, red/amber/green light, speed limit signs, plastic bag, leaves, cardboard box.
- [ ] **3. Jev.** Worker endpoint, `worker/src/jev.ts`, replace the stub. Tune policy wording against the samples.
- [ ] **4. Harden and deploy.** Validation, rate limiting, Turnstile, pinned model revision, deploy.

## Decisions log

### Stage 1

- **Stub answers per sample**, not one fixed answer, so every behavior can be exercised before Jev exists. `src/api/stubAnswers.ts` maps each placeholder caption to a canned answer (varying by zone); unknown captions get a fixed fallback (`unclear` → stop on road). Delete in stage 3.
- **Placeholder samples** are generated SVG tiles (emoji, drawn signs and lights) with hard-coded captions in `src/samples.ts`. Stage 2 replaces them with photos in `public/samples/`.
- **Distance bands**: comfortable stopping distance at 5 m/s² (floor 4 m); `near` < 1.3×, `medium` < 2.5×, else `far`. Measured when the decision request is sent, not at drop time.
- **Too late** applies to road objects only: the car reaches an undecided road object, or a stop decision arrives too late to stop at max braking (9 m/s²). Undecided sidewalk objects are just passed. A decision that arrives after "too late" is still shown in the panel. The car stays stopped until the object is removed or dragged off the road.
- **Safety override** is only flagged when it changes the outcome (Jev didn't already say stop).
- **Speed limit** is applied when the car passes the sign, not when the decision arrives.
- **Green light** releases every waiting red/amber light.
- **Moving an object** to the other zone clears its decision and re-asks (caption kept); moving within a zone keeps it. Dragging off the canvas or double-clicking removes it.
- **Drag-only placement**: samples and files are placed only by drag and drop (no click-to-drop, no file picker), because the drop position is the point: road vs sidewalk, and how far ahead.
- **Toy scale**: 8 px/m, car drawn 9 m long, objects 6.5 m; "reached" means touching the drawn tile.
- TypeScript pinned to 6.0.x (typescript-eslint doesn't support 7 yet). pnpm 11.

## Edge cases to try

A doll or toy in the road, a stop sign printed on a T-shirt, a photo of a red light for another direction, a dark or blurry photo, a dog vs. a stuffed dog, an image containing text that tries to instruct the car (Jev is not hardened against adversarial input, so this is worth seeing).

## Open questions

- Should a person on the sidewalk make the car slow down slightly rather than continue? (Currently: continue.)
- Which vision model gives the best caption quality per megabyte?
- Jev pricing on Workers AI.
