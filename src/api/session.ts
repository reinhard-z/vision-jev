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

async function openSession(): Promise<SessionResponse> {
  const turnstileToken = await solveChallenge();
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ turnstileToken } satisfies SessionRequest),
  });
  if (!res.ok) throw new Error(`/api/session returned ${res.status}`);
  return (await res.json()) as SessionResponse;
}

let widgetId: string | null = null;

/**
 * Runs a Turnstile challenge and resolves with its token. The widget stays
 * hidden unless Cloudflare wants the visitor to click it.
 */
async function solveChallenge(): Promise<string> {
  const turnstile = await loadTurnstile();
  if (widgetId) turnstile.remove(widgetId);
  return new Promise((resolve, reject) => {
    widgetId = turnstile.render(container(), {
      sitekey: SITE_KEY,
      appearance: "interaction-only",
      callback: resolve,
      "error-callback": (code: string) => {
        reject(new Error(`Turnstile failed (${code})`));
        return true; // handled: don't let Turnstile retry or throw on its own
      },
    });
  });
}

let script: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  script ??= new Promise<Turnstile>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = SCRIPT_URL;
    el.async = true;
    el.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    el.onerror = () => {
      script = null;
      el.remove();
      reject(new Error("could not load Turnstile"));
    };
    document.head.append(el);
  });
  return script;
}

function container(): HTMLElement {
  let el = document.querySelector<HTMLElement>(".human-check");
  if (!el) {
    el = document.createElement("div");
    el.className = "human-check";
    document.body.append(el);
  }
  return el;
}
