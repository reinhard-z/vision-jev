import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Model the external widget callbacks without executing Cloudflare's script.
let options: Record<string, unknown>;
const remove = vi.fn();
const render = vi.fn((_container: unknown, settings: Record<string, unknown>) => {
  options = settings;
  return "widget";
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { turnstile: { render, remove } });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ expiresAt: Date.now() + 3_600_000 }),
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Allow the async script and widget setup to reach its callback wait. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

it("shares verification and becomes ready only after the session exchange", async () => {
  const { ensureSession, sessionStore } = await import("./session");
  const first = ensureSession();
  const second = ensureSession();
  await flush();
  expect(render).toHaveBeenCalledTimes(1);
  expect(sessionStore.getState().state).toBe("checking");
  expect(fetch).not.toHaveBeenCalled();
  (options.callback as (token: string) => void)("verified");
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sessionStore.getState().state).toBe("ready");
  expect(remove).toHaveBeenCalledWith("widget");
});

it("cleans up stalled verification and allows a successful retry", async () => {
  const { ensureSession, sessionStore } = await import("./session");
  const failed = expect(ensureSession()).rejects.toThrow("Verification timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await failed;
  expect(sessionStore.getState().state).toBe("error");
  expect(remove).toHaveBeenCalledTimes(1);
  const retry = ensureSession();
  await flush();
  (options.callback as (token: string) => void)("verified");
  await retry;
  expect(sessionStore.getState().state).toBe("ready");
});

it("reports a refused session instead of claiming JEV is ready", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);
  const { ensureSession, sessionStore } = await import("./session");
  const failed = expect(ensureSession()).rejects.toThrow("403");
  await flush();
  (options.callback as (token: string) => void)("rejected");
  await failed;
  expect(sessionStore.getState().state).toBe("error");
});
