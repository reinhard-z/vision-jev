# Jev on Cloudflare Workers AI – Reference

Condensed from Cloudflare's model page and community notes, September 2026. If anything here seems incomplete or wrong, fetch the source instead of guessing:

- Model page (markdown): https://developers.cloudflare.com/ai/models/typesafe/jev/index.md
- Input schema: https://developers.cloudflare.com/ai/models/typesafe/jev/schema-input.json
- Output schema: https://developers.cloudflare.com/ai/models/typesafe/jev/schema-output.json

## What Jev is

A "System One" decision model from TypeSafe AI. It takes a **state** and a set of typed **questions** and returns typed answers with probabilities. It never generates text. All questions in one request are answered in parallel against the same state, so asking several questions costs about the same latency as asking one.

- Model id on Workers AI: `typesafe/jev` (currently resolves to `jev-1.13.0`)
- Context window: 32,000 tokens
- Text only
- Zero data retention on Workers AI
- Pricing: shown in the Cloudflare dashboard under AI → Models → typesafe/jev

## Binding

In the Wrangler config:

```toml
[ai]
binding = "AI"
```

(or `"ai": { "binding": "AI" }` in `wrangler.jsonc`)

## Request

```ts
const result = await env.AI.run("typesafe/jev", {
  state, // string, object, or array
  questions, // object: questionKey -> question definition
});
```

Note: this is Cloudflare's shape. TypeSafe direct and OpenRouter use a different request format (`model`, `state`, `questions` at the top level of a POST to a `/v1/systemone` endpoint). Vercel AI Gateway uses the AI SDK's `experimental_evaluate`. Keep provider differences inside `worker/src/jev.ts`.

### Question types

Each question has `type`, `instructions`, and usually `criteria`.

**noul** – yes/no, returns a probability.

```ts
could_be_person: {
  type: "noul",
  instructions: "Could `object_seen` be a person, or easily be mistaken for one?",
  criteria: {
    true: "A person, child, or human-like figure",
    false: "Clearly not a person",
  },
}
```

**choice** – pick one label (up to 255). `criteria` maps each label to a description. Returns the winning label, confidence, and full probabilities.

```ts
action: {
  type: "choice",
  instructions: "What should the car do about `object_seen` at `location`?",
  criteria: {
    continue: "Nothing on the road needs a reaction",
    slow_down: "Something could enter the road soon",
    stop: "A person, animal, vehicle, or obstacle is on the road",
  },
}
```

**score** – position on an ordered rubric (2–10 levels). `criteria` is an array from lowest to highest. Returns a probability-weighted score, confidence, legend, and probabilities.

```ts
danger: {
  type: "score",
  instructions: "How dangerous is `object_seen` for the car and others?",
  criteria: ["Harmless", "Needs attention", "Immediate danger"],
}
```

Referring to state fields with backticks in `instructions` (e.g. `` `object_seen` ``) points Jev directly at the relevant part.

## Response

Shape (values illustrative):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "could_be_person": { "type": "noul", "noul": 0.97 },
    "action": {
      "type": "choice",
      "choice": "stop",
      "confidence": 0.9,
      "probabilities": { "continue": 0.01, "slow_down": 0.06, "stop": 0.93 }
    },
    "danger": {
      "type": "score",
      "score": 1.9,
      "confidence": 0.85,
      "legend": {
        "0": "Harmless",
        "1": "Needs attention",
        "2": "Immediate danger"
      },
      "probabilities": { "0": 0.0, "1": 0.1, "2": 0.9 }
    }
  },
  "usage": { "input_tokens": 400, "output_tokens": 40 }
}
```

**Observed through the Workers AI binding (2026-09-26):** `env.AI.run` returns the body above wrapped in an envelope: `{ "state": "Completed", "result": { "model", "answers", "usage" }, "gatewayMetadata": { "keySource": "Unified" } }`. Jev is billed through prepaid AI Gateway credits (Unified Billing), not the free Workers AI allowance; without credits the call fails with `2021: Insufficient AI Gateway credits`.

- noul answers use the key `noul` (a probability).
- choice answers use `choice`, `confidence`, `probabilities`.
- score answers use `score`, `confidence`, `legend`, `probabilities`. Probability keys are level indices as strings.

## Known weaknesses ("jaggedness", per TypeSafe)

- **No arithmetic.** Don't ask it to compare numbers, count, or compute distances. Do that in code and pass the result as words.
- **Reads literally.** Avoid double negatives and multi-hop references. Point directly at the relevant field.
- **Irrelevant context hurts.** Keep the state small and focused.
- **Score levels aren't measurements.** Use scores to threshold or rank, not to interpolate.
- **Not hardened against adversarial input.** Text in the state that tries to steer the model can move answers. Treat captions as untrusted.
- **Valid ≠ correct.** Answers always fit the schema, but can still be the wrong option. Use confidence to gate decisions.

## Useful patterns

- **Speculative fan-out:** ask every question you might need in one call and let code decide which answers matter.
- **Confidence gating:** act automatically above a threshold; fall back to a cautious default below it.

## Sources

- https://developers.cloudflare.com/ai/models/typesafe/jev/
- https://github.com/zeke/jev (research notes and a Cloudflare Worker demo)
- https://docs.typesafe.ai
