# Vision model comparison (stage 2)

Which in-browser model captions the dropped images. Measured on 2026-09-26 with Transformers.js 4.3.0 on an Apple Silicon Mac: headed Chrome for WebGPU, headless Chromium for the Wasm fallback. Every model was run in greedy decoding (`do_sample: false`).

**Decision: Florence-2-base-ft with the `<CAPTION>` task, fed 384×384 images**, revision `e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f`. (First chosen at the native 768 px; switched to 384 px for speed, see [Input resolution](#input-resolution).) It is the only candidate that described both people correctly and named the lit lamp on most traffic lights, at about 1 s per caption on WebGPU. Configuration is in `src/perception/model.ts`.

## Test images

The 16 tray samples in `public/samples/`, plus two harder traffic lights used only for this comparison (smaller in frame, overcast sky; not in the repo):

- `hard-red`: [UK red traffic light signal, geograph 5092951](https://commons.wikimedia.org/wiki/File:UK_red_traffic_light_signal_-_geograph.org.uk_-_5092951.jpg), Gary, CC BY-SA 2.0
- `hard-green`: [UK Green Traffic Light Signal, geograph 5264298](https://commons.wikimedia.org/wiki/File:UK_Green_Traffic_Light_Signal_-_geograph.org.uk_-_5264298.jpg), Gary, CC BY-SA 2.0

The red, amber and green samples are one signal photographed in each state, so only the lit lamp differs.

## Candidates

| Model | Hugging Face repo | Transformers.js class | dtypes (WebGPU) | dtypes (Wasm) |
|---|---|---|---|---|
| Florence-2 base | `onnx-community/Florence-2-base-ft` | `Florence2ForConditionalGeneration` | embed fp16, vision fp16, encoder q4, decoder q4 | embed q8, vision q8, encoder q4, decoder q4 |
| SmolVLM-256M | `HuggingFaceTB/SmolVLM-256M-Instruct` | `AutoModelForVision2Seq` | embed fp16, vision q4, decoder q4 | embed q8, vision q4, decoder q4 |
| SmolVLM-500M | `HuggingFaceTB/SmolVLM-500M-Instruct` | `AutoModelForVision2Seq` | embed fp16, vision q4, decoder q4 | embed q8, vision q4, decoder q4 |
| Moondream2 | `Xenova/moondream2` | `Moondream1ForConditionalGeneration` | embed fp16, vision q8, decoder q4 | not run |

All four load in Transformers.js 4.3. Moondream2's model card snippet fails on 4.x ("Number of tokens and features do not match: tokens: 1, features 729"). It works once the `<image>` placeholder is repeated 729 times in the prompt.

Prompts: Florence-2 takes task tokens; `<CAPTION>`, `<DETAILED_CAPTION>` and `<MORE_DETAILED_CAPTION>` were tried. The chat models got "Describe the main object in this image in one sentence." and a variant that adds "If it is a traffic light, say which lamp is lit: red, amber or green."

## Results

| | Florence-2 | SmolVLM-256M | SmolVLM-500M | Moondream2 |
|---|---|---|---|---|
| Download, WebGPU / Wasm | 357 / 228 MB | 207 / 179 MB | 390 / 343 MB | 1,478 MB |
| Caption time, WebGPU (median) | 1.1 s | 0.9 s | 1.1 s | ~24 s |
| Caption time, Wasm (median) | 15 s | 9 s | 14 s | not run |
| Lit lamp named (5 lights) | 4/5 on both backends | 3/5 | 1/5 WebGPU, 0/5 Wasm | ~3/5, contradicts itself on amber |
| Child | ✅ | ✅ | ❌ "A soccer ball." | ✅ |
| Adult | ✅ (miscounts people) | ❌ "The white cross on the road." | ✅ | ✅ |

First loads here (download included, fast connection) took 6 to 15 s for the small models and 29 s for Moondream2; loads from the browser cache took 2 to 3 s. On a slower connection the first visit is dominated by the download.

### Captions

Florence-2 with `<CAPTION>`; SmolVLM and Moondream2 with the plain prompt. The Moondream2 run was stopped after 12 images once its speed ruled it out.

| Image | Florence-2 (WebGPU) | Florence-2 (Wasm) | SmolVLM-256M (WebGPU) | SmolVLM-500M (WebGPU) | Moondream2 (WebGPU) |
|---|---|---|---|---|---|
| child | A young boy playing with a soccer ball on the beach. | A little boy playing with a soccer ball on the beach. | The boy is standing on the sand. He is holding a red and white toy shovel in his hand. | A soccer ball. | A young boy stands on a sandy beach, holding a yellow shovel and a soccer ball, with a city skyline in the background. |
| adult | Three women walking down a street in the middle of the day. | Three women walking down a street in coats. | The white cross on the road. | A person is walking on the road. | A woman in a tan coat and black boots walks across a crosswalk, carrying a brown purse, with a cityscape in the background. |
| teddy | A small teddy bear sitting on a wooden bench. | A teddy bear sitting on a wooden bench. | Stuffed teddy bear sitting on a bench. | A teddy bear is sitting on a bench. | A brown teddy bear sits on a wooden bench, smiling and looking at the camera. |
| dog | A brown and white dog standing on top of a green field. | A brown dog standing on top of a lush green field. | Dog. | A dog is standing on the grass. | A brown and white dog stands on a lush green lawn, facing right with a black collar around its neck. |
| cat | A black and white cat sitting in the grass. | A cat sitting on the lawn in front of a house. | The cat is sitting on the grass. | A black and white cat is sitting on the grass in the foreground of the picture. | A black and white cat sits on a patch of grass in front of a house, with a yellow door and windows visible. |
| bicycle | A yellow bicycle is parked in the snow. | A yellow bicycle is parked in the snow. | A yellow bicycle. | A bicycle is parked on the snow. | A yellow bicycle with a black seat and handlebars is parked on a snowy ground, leaning against a white wall. |
| car | A red car parked in front of windmills. | A red car parked in front of windmills. | A car. | A red car is parked on the road. | A red hatchback car is parked on a road, with a field and wind turbines in the background. |
| stop | A stop sign is shown against a blue sky. | A red stop sign against a blue sky. | The sign is a stop sign. | A stop sign. | A red octagonal stop sign with white lettering stands against a clear blue sky. |
| red | A traffic light is shown in front of a building. | A traffic light with a red light on it. | The red light is on. | A traffic light. | A red traffic light with a white background and illuminated red light stands on a pole, with a building and a blue sign in the background. |
| amber | A traffic light with a yellow light in front of a building. | A traffic light that is on the side of a pole. | The light is turned on. | A traffic light. | A traffic light with a yellow light is mounted on a pole, displaying a red light, with a building and trees in the background. |
| green | A traffic light with a green light in front of a building. | A traffic light with a green light in front of a building. | The object is a traffic light. | A traffic light. | A green traffic light with a white background and black border is mounted on a pole, displaying a green light signal. |
| hard-red | A traffic light that is red on a pole. | A traffic light with a red light on it. | A red light. | A traffic light. | A red traffic light with a white background and black numbers is mounted on a gray pole, with a brown roofed building in the background. |
| hard-green | A traffic light with a green light on it. | A traffic light with a green light on it. | There is a green light. | A traffic light with a green light. | (not run) |
| limit30 | A red and white speed limit sign on a mountain. | A red and white sign with the numbers 30 and 60 on it. | A sign. | A round sign with the number 30 in the middle. | (not run) |
| limit80 | A red and white sign that says 80 on it. | A red and white sign that says 80 on it. | A sign with a red and white circle and the number '80' on it. | There is a round sign with the number 80 in the middle. | (not run) |
| box | A cardboard box is upside down on the floor. | A cardboard box with the lid open on the floor. | Empty box. | A cardboard box in the center of the image. | (not run) |
| bag | A picture of a paper bag with the word meijer on it. | A plastic bag with the word meijer on it. | The white plastic cover has the red text "meijer" on it. | A white plastic bag with the brand name "meijer" on it. | (not run) |
| leaves | A picture of a building with a lot of leaves on the ground. | A painting of a large pile of leaves in front of a building. | Leaves. | A wooden signboard with a yellow background is placed on the ground. The signboard is in the middle of the image. | (not run) |

### Findings

- **People.** Only Florence-2 (and the too-slow Moondream2) described both the child and the adult. SmolVLM-500M called the child photo "A soccer ball." and SmolVLM-256M called the adult "The white cross on the road." The spec prefers false alarms over missed hazards, so a missed person rules a model out.
- **Traffic lights.** Florence-2 `<CAPTION>` named the lamp on 4 of 5 lights on both backends, but not the same four. The WebGPU run (fp16 vision encoder) missed the Singapore red ("A traffic light is shown in front of a building."); the Wasm run (q8) missed amber. So lamp detection is borderline and precision-sensitive, and Jev has to cope with captions that say "a traffic light" and nothing more. Florence-2's longer tasks were worse: `<MORE_DETAILED_CAPTION>` described the red light as "It is red and there are no lights on it."
- **Asking about the lamp backfires on SmolVLM.** With the traffic-light hint, SmolVLM-256M answered "The traffic light is red." for the teddy, dog and cat, and SmolVLM-500M answered "Red." for every image. The hint leaks into non-light images, so it can't be used.
- **Other Florence-2 errors:** it miscounts people ("Three women" for two), calls the plastic bag "paper" on WebGPU (right on Wasm), sees "30 and 60" on the 30 sign on Wasm, and is vague about the pile of leaves ("a building with a lot of leaves on the ground").
- **Moondream2** gave the richest and mostly correct descriptions, but a 1.5 GB download and ~24 s per caption on WebGPU rule it out for a real-time game.
- **Wasm is a fallback, not a way to play.** About 15 s per Florence-2 caption means road objects dropped at normal distances usually end up "too late". It works and it's smooth, just slow; the status line says "Wasm (CPU, slower)".

## Splitting modules across devices

Transformers.js can put each ONNX module on its own device. Moving Florence-2's vision encoder (and optionally the text encoder) to Wasm while keeping the decoder on WebGPU raised the caption time from 1.1 s to 11–12.5 s. The vision encoder is the expensive part, so this was dropped.

## Frame pacing in the app

Measured in the running app with a rAF frame-time recorder and a `longtask` observer while dropping 4 to 8 samples.

- **First version: stutter on WebGPU.** The main thread was never blocked (no long tasks), but frames were dropped for 70–480 ms, at model load and in the first ~400 ms of each caption, when the vision and text encoders run. Chrome's 2D canvas is GPU-accelerated, so the road canvas queued behind the inference work on the GPU. A page without a per-frame canvas showed no dropped frames with the same model.
- **Fix: CPU canvas** (`getContext("2d", { willReadFrequently: true })` in `RoadCanvas.tsx`). With 8 objects captioned back to back on WebGPU, the max frame was 18 ms, with none over 50 ms (120 Hz display; median 8.3 ms, p95 10.1 ms, up from 9.3 ms).
- **Wasm fallback** (headless Chromium without WebGPU flags, where `requestAdapter()` returns null in the page and the worker): median 16.7 ms, max 16.8 ms at 60 Hz during 45 s of continuous captioning.

## Input resolution

Profiling Florence-2 at 768 px on WebGPU (M1): preprocessing ~35 ms, image and prompt encoding up to the first token ~980 ms, then ~12 ms per generated token (~150 ms for a caption). Almost all the time is the vision encoder, whose cost grows with pixel count. Other vision-encoder precisions were not faster (time to first token: fp16 ~0.98 s, q4f16 ~1.07 s, fp32 ~1.37 s, q4 ~1.39 s).

Feeding smaller images (`processor.image_processor.size`), same weights:

| Input | Per caption (harness) | Output |
|---|---|---|
| 768 px (native) | ~1.1 s | Full sentences |
| 384 px | ~0.37–0.40 s | Full sentences; named the lamp on 5/5 lights |
| 512 px | ~0.5 s | One-word labels ("boxer", "soccer ball", "unanswerable") |
| 576 px | ~0.59 s | One-word labels |
| 1152 px | ~2.2 s | One-word labels, some wrong ("lion" for the dog) |

Only 384 and 768 produce captions; everything else collapses to single labels. The app now uses 384 px. Known quirk at 384 px: it often invents a second object ("Two children playing with soccer balls", "Two teddy bears", "Two cats"). It named the 80 sign's number but not the 30 sign's.

In the app at 384 px: 0.39–0.46 s vision time per caption after a 0.6 s first caption, with no frame over 50 ms during captioning.

## Faster models (WebGPU, M1)

Also tested for speed, `<CAPTION>` or plain prompt, same 18 images:

| Model | Per caption | Download | Lamp named (5) | Notes |
|---|---|---|---|---|
| LFM2.5-VL-450M (`onnx-community/LFM2.5-VL-450M-ONNX`) | 0.80 s | 545 MB | 5/5 | Best captions of the fast group: both people, both speed-limit numbers, "plastic bag", "pile of brown leaves". License and Wasm speed not checked. |
| distilvit (`Mozilla/distilvit`) | 0.40 s | 561 MB | 1/5 | "A traffic light with a heart symbol"; calls speed signs stop signs |
| vit-gpt2 (`Xenova/vit-gpt2-image-captioning`) | 0.59 s | 789 MB | 2/5 | Says "green" for red; bag becomes "a broken umbrella" |
| FastVLM-0.5B (`onnx-community/FastVLM-0.5B-ONNX`) | 2.25 s | 807 MB | 5/5 | Detailed but verbose and slow on an M1 |

distilvit and vit-gpt2 only load with the fp32 decoder; their fp16 merged decoders are rejected by onnxruntime-web ("Subgraph output (logits) is an outer scope value being returned directly").
