import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecideResponse } from "../shared/types";
import { decide } from "./api/decide";
import { ROAD_LEFT, ROAD_RIGHT } from "./game/constants";
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
const stop = {
  category: pick("person"),
  action: pick("stop"),
  lightState: pick("not_a_light"),
  speedLimit: pick("none"),
  couldBePerson: 0.9,
  latencyMs: 1,
} as unknown as DecideResponse;

const roadX = (ROAD_LEFT + ROAD_RIGHT) / 2;
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
    vi.mocked(decide).mockResolvedValue({ response: stop, roundTripMs: 7 });
    await pipeline.spawn("/samples/child.jpg", roadX, 100);
    expect(cards().map((c) => c.phase.kind)).toEqual(["decided"]);
    expect(vi.mocked(decide).mock.calls[0]![0]).toMatchObject({ caption: "a child", zone: "road" });
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
