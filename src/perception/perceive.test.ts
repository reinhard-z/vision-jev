import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for the vision worker; the test drives its callbacks. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
}

const bitmap = () => ({ width: 100, height: 80, close: vi.fn() });

describe("perceive", () => {
  beforeEach(() => {
    vi.resetModules(); // perceive.ts keeps the worker in module state
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob()) })));
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.resolve(bitmap())));
  });

  it("resolves with the worker's caption", async () => {
    const { perceive } = await import("./perceive");
    const pending = perceive("/samples/dog.jpg");
    await vi.waitFor(() => expect(FakeWorker.last?.posted).toHaveLength(2)); // load + caption
    FakeWorker.last!.onmessage!({ data: { type: "caption", id: 1, text: " A dog ", ms: 12.4 } } as MessageEvent);
    await expect(pending).resolves.toEqual({ caption: "A dog", visionMs: 12 });
  });

  it("rejects waiting captions when the worker crashes, and later ones right away", async () => {
    const { perceive, getVisionStatus } = await import("./perceive");
    const pending = perceive("/samples/dog.jpg");
    await vi.waitFor(() => expect(FakeWorker.last?.posted).toHaveLength(2));
    FakeWorker.last!.onerror!({ message: "" } as ErrorEvent);
    await expect(pending).rejects.toThrow("vision worker crashed");
    expect(getVisionStatus()).toEqual({ state: "error", message: "vision worker crashed" });
    await expect(perceive("/samples/cat.jpg")).rejects.toThrow("vision worker crashed");
  });
});
