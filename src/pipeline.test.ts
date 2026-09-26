import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecideResponse } from "../shared/types";
import { decide } from "./api/decide";
import { ROAD_MID, ROAD_RIGHT } from "./game/constants";
import { Game } from "./game/engine";
import { perceive } from "./perception/perceive";
import { Pipeline } from "./pipeline";

vi.mock("./api/decide", () => ({ decide: vi.fn() }));
vi.mock("./perception/perceive", () => ({ perceive: vi.fn() }));

/** Minimal stand-in for HTMLImageElement: loads unless the URL says "broken". */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(url: string) {
    queueMicrotask(() => (url.includes("broken") ? this.onerror?.() : this.onload?.()));
  }
}

const pick = <T extends string>(choice: T) => ({ choice, confidence: 0.9, probabilities: { [choice]: 0.9 } });
const child = {
  action: pick("stop"),
  category: pick("person"),
  speedLimit: pick("none"),
  latencyMs: 1,
} as unknown as DecideResponse;

const roadX = (ROAD_MID + ROAD_RIGHT) / 2; // the car's lane
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("Pipeline", () => {
  let game: Game;
  let pipeline: Pipeline;
  let detach: () => void;
  const cards = () => game.ui.getState().cards;

  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    vi.spyOn(console, "error").mockImplementation(() => {});
    game = new Game();
    pipeline = new Pipeline(game);
    detach = pipeline.attach();
  });

  afterEach(() => {
    detach();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captions, decides and applies the decision", async () => {
    vi.mocked(perceive).mockResolvedValue({ caption: "a child", visionMs: 5 });
    vi.mocked(decide).mockResolvedValue({ response: child, roundTripMs: 7 });
    await pipeline.spawn("/samples/child.jpg", roadX, 100);
    expect(cards().map((c) => c.phase.kind)).toEqual(["decided"]);
    expect(game.objects[0]!.decision?.resolved.behavior.kind).toBe("stop");
    // The caption and the zone leave the browser; distance and speed stay in the game.
    expect(vi.mocked(decide).mock.calls[0]![0]).toEqual({ caption: "a child", zone: "own_lane" });
  });

  it("starts captioning at drag start and reuses it on the drop", async () => {
    let finish: (p: { caption: string; visionMs: number }) => void = () => {};
    vi.mocked(perceive).mockReturnValue(new Promise((r) => (finish = r)));
    vi.mocked(decide).mockResolvedValue({ response: child, roundTripMs: 7 });
    pipeline.prefetch("/samples/child.jpg");
    expect(perceive).toHaveBeenCalledTimes(1);
    const done = pipeline.spawn("/samples/child.jpg", roadX, 100);
    finish({ caption: "a child", visionMs: 5 });
    await done;
    expect(perceive).toHaveBeenCalledTimes(1);
    expect(game.objects[0]!.caption).toBe("a child");
  });

  it("captions an image again after a failed caption", async () => {
    vi.mocked(perceive).mockRejectedValueOnce(new Error("busy"));
    pipeline.prefetch("/samples/box.jpg");
    await settle();
    vi.mocked(perceive).mockResolvedValue({ caption: "a box", visionMs: 5 });
    vi.mocked(decide).mockResolvedValue({ response: child, roundTripMs: 7 });
    await pipeline.spawn("/samples/box.jpg", roadX, 100);
    expect(perceive).toHaveBeenCalledTimes(2);
    expect(game.objects[0]!.caption).toBe("a box");
  });

  it("asks Jev again with the new zone when an object is moved", async () => {
    vi.mocked(perceive).mockResolvedValue({ caption: "a child", visionMs: 5 });
    vi.mocked(decide).mockResolvedValue({ response: child, roundTripMs: 7 });
    await pipeline.spawn("/samples/child.jpg", roadX, 100);
    const obj = game.objects[0]!;
    game.startDrag(obj.id, obj.x, 100);
    game.endDrag(obj.id, 20, 100, true);
    await settle();
    expect(vi.mocked(decide).mock.calls.map((c) => c[0].zone)).toEqual(["own_lane", "far_sidewalk"]);
    expect(obj.phase.kind).toBe("decided");
  });

  it("adds nothing for an image that won't load, and doesn't reject", async () => {
    await expect(pipeline.spawn("blob:broken", roadX, 100)).resolves.toBeUndefined();
    expect(cards()).toEqual([]);
    expect(perceive).not.toHaveBeenCalled();
  });

  it("reports a failed caption to the game", async () => {
    vi.mocked(perceive).mockRejectedValue(new Error("worker crashed"));
    await pipeline.spawn("/samples/box.jpg", roadX, 100);
    const [obj] = game.objects;
    expect(obj!.decision?.outcome).toEqual({ kind: "failed", stage: "perception" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("reports a failed decision to the game", async () => {
    vi.mocked(perceive).mockResolvedValue({ caption: "a box", visionMs: 5 });
    vi.mocked(decide).mockRejectedValue(new Error("502"));
    await pipeline.spawn("/samples/box.jpg", roadX, 100);
    expect(game.objects[0]!.decision?.outcome).toEqual({ kind: "failed", stage: "decision" });
  });

  it("cancels the request of an object that is removed while deciding", async () => {
    vi.mocked(perceive).mockResolvedValue({ caption: "a box", visionMs: 5 });
    let signal: AbortSignal | undefined;
    vi.mocked(decide).mockImplementation((_, s) => {
      signal = s;
      return new Promise((_, reject) => s?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const done = pipeline.spawn("/samples/box.jpg", roadX, 100);
    await settle();
    game.removeObject(game.objects[0]!.id);
    await done;
    expect(signal?.aborted).toBe(true);
    expect(console.error).not.toHaveBeenCalledWith("decision failed", expect.anything());
  });
});
