// The only place that talks to Jev. Swap providers here (docs/jev.md).

const MODEL = "typesafe/jev";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export interface JevResult {
  answers: Record<string, JevAnswer>;
  model: string;
  inputTokens: number;
  /** Time spent in the Jev call, as seen by the Worker. */
  latencyMs: number;
}

export class JevError extends Error {}

/** Ask all questions against one state in a single call. */
export async function evaluate(
  ai: Ai,
  state: Record<string, string>,
  questions: Record<string, JevQuestion>,
): Promise<JevResult> {
  const started = Date.now();
  const envelope = await ai.run(MODEL, { state, questions });
  const latencyMs = Date.now() - started;
  const raw = unwrap(envelope);

  // Answers always fit the schema in theory; check anyway rather than trust it.
  const answers: Record<string, JevAnswer> = {};
  const rawAnswers = raw.answers;
  if (!isObject(rawAnswers)) throw new JevError("response has no answers");
  for (const [key, q] of Object.entries(questions)) {
    const a = rawAnswers[key];
    if (!isObject(a) || a.type !== q.type) throw new JevError(`answer ${key} missing or wrong type`);
    if (q.type === "noul") {
      if (!isProbability(a.noul)) throw new JevError(`answer ${key} has no noul`);
      answers[key] = { type: "noul", noul: a.noul };
    } else {
      const { choice, confidence, probabilities } = a;
      if (typeof choice !== "string" || !(choice in q.criteria)) throw new JevError(`answer ${key} has unknown choice`);
      if (!isProbability(confidence) || !isObject(probabilities)) throw new JevError(`answer ${key} is incomplete`);
      const probs: Record<string, number> = {};
      for (const label of Object.keys(q.criteria)) {
        const p = probabilities[label];
        probs[label] = isProbability(p) ? p : 0;
      }
      answers[key] = { type: "choice", choice, confidence, probabilities: probs };
    }
  }

  const usage = raw.usage;
  const inputTokens = isObject(usage) && typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const model = typeof raw.model === "string" ? raw.model : MODEL;
  return { answers, model, inputTokens, latencyMs };
}

/**
 * The binding (via AI Gateway) wraps the documented body as
 * `{ state: "Completed", result: {...}, gatewayMetadata }`. Accept both.
 */
function unwrap(envelope: Record<string, unknown>): Record<string, unknown> {
  if ("answers" in envelope) return envelope;
  if (envelope.state !== "Completed" || !isObject(envelope.result)) {
    throw new JevError(`unexpected response state: ${String(envelope.state).slice(0, 40)}`);
  }
  return envelope.result;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isProbability(v: unknown): v is number {
  return typeof v === "number" && v >= 0 && v <= 1;
}
