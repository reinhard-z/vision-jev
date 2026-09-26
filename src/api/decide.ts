import type { DecideRequest, DecideResponse } from "../../shared/types";

export interface Decision {
  response: DecideResponse;
  /** Browser round trip for the request, measured here. Client-only. */
  roundTripMs: number;
}

/** Ask the Worker for a driving decision. Throws on network or server errors. */
export async function decide(req: DecideRequest): Promise<Decision> {
  const started = performance.now();
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`/api/decide returned ${res.status}`);
  const response = (await res.json()) as DecideResponse;
  return { response, roundTripMs: Math.round(performance.now() - started) };
}
