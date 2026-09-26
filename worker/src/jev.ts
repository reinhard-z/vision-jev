// The only place that talks to Jev. Swap providers here (docs/jev.md).
import { z } from "zod";

const MODEL = "typesafe/jev";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

export type Questions = Record<string, JevQuestion>;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ChoiceAnswer<L extends string> {
  type: "choice";
  choice: L;
  confidence: number;
  /** Every label of the question, 0 when Jev gave none. */
  probabilities: Record<L, number>;
}

/** Answers typed per question: choice labels come from each question's criteria. */
export type Answers<Q extends Questions> = {
  [K in keyof Q]: Q[K] extends { type: "choice"; criteria: infer C } ? ChoiceAnswer<keyof C & string> : NoulAnswer;
};

export interface JevResult<Q extends Questions> {
  answers: Answers<Q>;
  model: string;
  inputTokens: number;
  /** Time spent in the Jev call, as seen by the Worker. */
  latencyMs: number;
}

export class JevError extends Error {}

/** Ask all questions against one state in a single call. */
export async function evaluate<Q extends Questions>(
  ai: Ai,
  state: Record<string, string>,
  questions: Q,
): Promise<JevResult<Q>> {
  const started = Date.now();
  const envelope: unknown = await ai.run(MODEL, { state, questions });
  const latencyMs = Date.now() - started;

  // Answers always fit the schema in theory; check anyway rather than trust it.
  const parsed = responseSchema(questions).safeParse(envelope);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new JevError(`unexpected response at ${issue?.path.join(".") || "root"}: ${issue?.message ?? "invalid"}`);
  }
  const body = "result" in parsed.data ? parsed.data.result : parsed.data;
  return {
    // The schema was built from `questions`, so the answers have exactly this shape.
    answers: body.answers as Answers<Q>,
    model: body.model ?? MODEL,
    inputTokens: body.usage?.input_tokens ?? 0,
    latencyMs,
  };
}

const probability = z.number().min(0).max(1);

function answerSchema(q: JevQuestion) {
  if (q.type === "noul") return z.object({ type: z.literal("noul"), noul: probability });
  const labels = Object.keys(q.criteria);
  return z.object({
    type: z.literal("choice"),
    choice: z.enum(labels),
    confidence: probability,
    probabilities: z
      .record(z.string(), z.unknown())
      .transform((p) => Object.fromEntries(labels.map((l) => [l, probability.safeParse(p[l]).data ?? 0]))),
  });
}

/**
 * The documented body, or the binding's envelope around it
 * (`{ state: "Completed", result: {...}, gatewayMetadata }`, via AI Gateway).
 */
function responseSchema(questions: Questions) {
  const body = z.object({
    model: z.string().optional(),
    answers: z.object(Object.fromEntries(Object.entries(questions).map(([key, q]) => [key, answerSchema(q)]))),
    usage: z.object({ input_tokens: z.number().optional() }).optional(),
  });
  return z.union([z.object({ state: z.literal("Completed"), result: body }), body]);
}
