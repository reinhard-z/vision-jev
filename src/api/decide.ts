import type { DecideRequest, DecideResponse } from "../../shared/types";
import { cannedAnswer } from "./stubAnswers";

/** Client-side context for the stub. Never sent to the server. */
export interface DecideContext {
  /** Tray sample the object came from; undefined for the user's own images. */
  sampleId?: string;
}

/**
 * Ask for a driving decision. STUB (stages 1–2): returns the canned answer
 * for the sample after a fake delay. Stage 3 replaces the body with
 * `fetch("/api/decide")` and drops `ctx`.
 */
export async function decide(req: DecideRequest, ctx: DecideContext = {}): Promise<DecideResponse> {
  const latencyMs = Math.round(600 + Math.random() * 900);
  await new Promise((resolve) => setTimeout(resolve, latencyMs));
  return cannedAnswer(req, ctx.sampleId, latencyMs);
}
