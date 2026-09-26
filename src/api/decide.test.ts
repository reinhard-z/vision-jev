import { afterEach, expect, it, vi } from "vitest";
import { ensureSession } from "./session";
import { decide } from "./decide";

vi.mock("./session", () => ({ ensureSession: vi.fn(), dropSession: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("starts the API deadline only after verification finishes", async () => {
  let verify: () => void = () => {};
  vi.mocked(ensureSession).mockReturnValue(new Promise<void>((resolve) => (verify = resolve)));
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  const result = decide({ caption: "a child", zone: "own_lane" });
  expect(timeout).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  verify();
  await result;
  expect(timeout).toHaveBeenCalledWith(10_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cancels a pending decision while shared verification continues", async () => {
  vi.mocked(ensureSession).mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", vi.fn());
  const controller = new AbortController();
  const result = decide({ caption: "a child", zone: "own_lane" }, controller.signal);
  controller.abort(new Error("object removed"));
  await expect(result).rejects.toThrow("object removed");
  expect(fetch).not.toHaveBeenCalled();
});
