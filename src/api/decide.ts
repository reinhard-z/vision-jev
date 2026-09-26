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
 * errors, after TIMEOUT_MS per request, or when `signal` aborts. Verification
 * has its own deadline so startup cannot consume the decision's time budget.
 */
export async function decide(req: DecideRequest, signal?: AbortSignal): Promise<Decision> {
  const started = performance.now();
  await waitForSession(signal);
  let res = await post(req, signal);
  if (res.status === 401) {
    dropSession();
    await waitForSession(signal);
    res = await post(req, signal);
  }
  if (!res.ok) throw new Error(`/api/decide returned ${res.status}`);
  // Same-origin API that validates Jev's output; the shared type is the contract.
  const response = (await res.json()) as DecideResponse;
  return { response, roundTripMs: Math.round(performance.now() - started) };
}

/** Each API attempt gets its own timeout after verification has finished. */
function post(req: DecideRequest, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/** Cancel this caller's wait without cancelling verification shared by others. */
async function waitForSession(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) return ensureSession();
  let abort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([ensureSession(), aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
