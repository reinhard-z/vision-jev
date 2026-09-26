import type { DecideRequest, DecideResponse } from "../../shared/types";
import { dropSession, ensureSession } from "./session";

export interface Decision {
  response: DecideResponse;
  /** Browser round trip for the request, measured here. Client-only. */
  roundTripMs: number;
}

// Well above the p95 (~0.5 s); past this the car is better off stopping.
const TIMEOUT_MS = 10_000;

/**
 * Ask the Worker for a driving decision. Opens a session first if needed, and
 * once more if the Worker no longer accepts it. Throws on network or server
 * errors, after TIMEOUT_MS, or when `signal` aborts.
 */
export async function decide(req: DecideRequest, signal?: AbortSignal): Promise<Decision> {
  const started = performance.now();
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  await ensureSession();
  let res = await post(req, combined);
  if (res.status === 401) {
    dropSession();
    await ensureSession();
    res = await post(req, combined);
  }
  if (!res.ok) throw new Error(`/api/decide returned ${res.status}`);
  // Same-origin API that validates Jev's output; the shared type is the contract.
  const response = (await res.json()) as DecideResponse;
  return { response, roundTripMs: Math.round(performance.now() - started) };
}

function post(req: DecideRequest, signal: AbortSignal): Promise<Response> {
  return fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
}
