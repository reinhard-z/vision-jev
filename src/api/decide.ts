import type { DecideRequest, DecideResponse } from "../../shared/types";
import { cannedAnswer } from "./stubAnswers";

/**
 * Ask for a driving decision. STAGE 1 STUB: returns a canned answer after a
 * fake delay. Stage 3 replaces the body with `fetch("/api/decide")`.
 */
export async function decide(req: DecideRequest): Promise<DecideResponse> {
  const latencyMs = Math.round(600 + Math.random() * 900);
  await new Promise((resolve) => setTimeout(resolve, latencyMs));
  return cannedAnswer(req, latencyMs);
}
