import { createStore } from "zustand/vanilla";
import type { SessionRequest, SessionResponse } from "../../shared/types";

// Turnstile proves a human is playing before the Worker spends Jev calls. A
// solved challenge buys an hour-long session cookie (Turnstile tokens are
// single-use), so decisions themselves never wait for a challenge.

// Site keys are public. Dev uses Cloudflare's test key, which always passes
// and works on localhost; the Worker's .dev.vars holds the matching secret.
const SITE_KEY = import.meta.env.DEV ? "1x00000000000000000000AA" : "0x4AAAAAAFEWLkQW--aeCd3b";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Renew a little early so a decision never races the expiry.
const RENEW_MARGIN_MS = 60_000;
const VERIFICATION_TIMEOUT_MS = 30_000;

/** Shared readiness for startup, session renewal, and the retry control. */
export const sessionStore = createStore<{ state: "checking" | "ready" | "error" }>(() => ({ state: "checking" }));

/** The small part of Cloudflare's browser API used to establish sessions. */
interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let session: Promise<SessionResponse> | null = null;

/** Resolves once the browser holds a session cookie that is good for a while. */
export async function ensureSession(): Promise<void> {
  const pending = (session ??= openSession());
  try {
    const { expiresAt } = await pending;
    if (expiresAt - Date.now() > RENEW_MARGIN_MS) return;
  } catch (err) {
    if (session === pending) session = null; // let the next call try again
    throw err;
  }
  // About to expire: the first caller to notice opens a new one, the rest wait for it.
  if (session === pending) session = null;
  return ensureSession();
}

/** Drops the session so the next ensureSession() opens a new one (after a 401). */
export function dropSession(): void {
  session = null;
}

/** Exchange the single-use challenge token for the Worker's session cookie. */
async function openSession(): Promise<SessionResponse> {
  sessionStore.setState({ state: "checking" });
  try {
    const turnstileToken = await solveChallenge();
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken } satisfies SessionRequest),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`/api/session returned ${res.status}`);
    const result = (await res.json()) as SessionResponse;
    sessionStore.setState({ state: "ready" });
    return result;
  } catch (err) {
    sessionStore.setState({ state: "error" });
    throw err;
  }
}

/** Run automatic verification, with a deadline and cleanup for every outcome. */
async function solveChallenge(): Promise<string> {
  const turnstile = await loadTurnstile();
  let widgetId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Verification timed out")), VERIFICATION_TIMEOUT_MS);
      widgetId = turnstile.render(container(), {
        sitekey: SITE_KEY,
        // The widget's non-interactive mode is configured in Cloudflare.
        appearance: "always",
        theme: "dark",
        size: "flexible",
        retry: "never",
        callback: resolve,
        "error-callback": (code: string) => {
          reject(new Error(`Turnstile failed (${code})`));
          return true;
        },
        "timeout-callback": () => reject(new Error("Verification timed out")),
        "unsupported-callback": () => reject(new Error("Browser cannot run verification")),
        "expired-callback": () => reject(new Error("Verification expired")),
      });
    });
  } finally {
    clearTimeout(timer);
    if (widgetId !== undefined) turnstile.remove(widgetId);
  }
}

let script: Promise<Turnstile> | null = null;

/** Share one script load across callers; network failures allow a later retry. */
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  script ??= new Promise<Turnstile>((resolve, reject) => {
    const el = document.createElement("script");
    const timer = setTimeout(() => fail(), VERIFICATION_TIMEOUT_MS);
    // A failed or stalled script must not poison later retries.
    const fail = () => {
      clearTimeout(timer);
      el.onload = null;
      el.onerror = null;
      el.remove();
      script = null;
      reject(new Error("Could not load verification"));
    };
    el.src = SCRIPT_URL;
    el.async = true;
    el.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    el.onerror = fail;
    document.head.append(el);
  });
  return script;
}

/** React owns the surrounding status panel; Turnstile owns only this element. */
function container(): HTMLElement {
  const el = document.getElementById("human-check-widget");
  if (!el) throw new Error("Verification container is missing");
  return el;
}
