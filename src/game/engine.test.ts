import { describe, expect, it } from "vitest";
import type { Zone } from "../../shared/types";
import { cannedAnswer } from "../api/stubAnswers";
import { resolveBehavior } from "./behaviors";
import { OBJECT_HALF_LENGTH_M, PX_PER_M, ROAD_LEFT, ROAD_RIGHT } from "./constants";
import { Game } from "./engine";
import { distanceBand, kmhToMs, msToKmh } from "./physics";

const CAPTIONS = {
  child: "a small child in a red jacket standing",
  teddy: "a teddy bear lying on the ground",
  stop: "a red octagonal stop sign",
  red: "a traffic light with the red lamp lit",
  green: "a traffic light with the green lamp lit",
  limit30: "a round speed limit sign showing 30",
  box: "a cardboard box",
  leaves: "a pile of dry autumn leaves",
};

const fakeImage = {} as HTMLImageElement;

/** Add an object whose near edge is `ahead` metres in front of the car. */
function add(game: Game, zone: Zone, ahead: number): string {
  const x = zone === "road" ? (ROAD_LEFT + ROAD_RIGHT) / 2 : 40;
  const y = game.carFrontY - (ahead + OBJECT_HALF_LENGTH_M) * PX_PER_M;
  return game.addObject(fakeImage, "", x, y);
}

/** Add an object and immediately give it the canned decision for `caption`. */
function addDecided(game: Game, zone: Zone, ahead: number, caption: string): string {
  const id = add(game, zone, ahead);
  game.setCaption(id, caption, 0);
  const t = game.beginDecision(id)!;
  game.applyDecision(id, t.seq, cannedAnswer({ ...t }, 0));
  return id;
}

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * 120; i++) {
    game.update(1 / 120);
    each?.();
  }
}

const kmh = (game: Game) => msToKmh(game.speedMs);

describe("distanceBand", () => {
  it("scales with speed", () => {
    const v = kmhToMs(50); // comfortable stop ≈ 19.3 m
    expect(distanceBand(60, v)).toBe("far");
    expect(distanceBand(35, v)).toBe("medium");
    expect(distanceBand(15, v)).toBe("near");
    expect(distanceBand(15, kmhToMs(20))).toBe("far");
  });
});

describe("resolveBehavior", () => {
  const req = (caption: string, zone: Zone) => cannedAnswer({ caption, zone, distance: "far", speedKmh: 50 }, 0);

  it("applies the safety override only on the road", () => {
    expect(resolveBehavior(req(CAPTIONS.teddy, "road"), "road")).toMatchObject({
      behavior: { kind: "stop" },
      safetyOverride: true,
    });
    expect(resolveBehavior(req(CAPTIONS.teddy, "sidewalk"), "sidewalk").safetyOverride).toBe(false);
  });

  it("doesn't flag the override when Jev already said stop", () => {
    expect(resolveBehavior(req(CAPTIONS.child, "road"), "road")).toMatchObject({
      behavior: { kind: "stop" },
      safetyOverride: false,
    });
  });

  it("maps signs and lights by category", () => {
    expect(resolveBehavior(req(CAPTIONS.stop, "road"), "road").behavior.kind).toBe("stop_sign");
    expect(resolveBehavior(req(CAPTIONS.red, "sidewalk"), "sidewalk").behavior).toEqual({ kind: "red_light", light: "red" });
    expect(resolveBehavior(req(CAPTIONS.green, "sidewalk"), "sidewalk").behavior.kind).toBe("green_light");
    expect(resolveBehavior(req(CAPTIONS.limit30, "sidewalk"), "sidewalk").behavior).toEqual({ kind: "speed_limit", kmh: 30 });
  });

  it("falls back to the action", () => {
    expect(resolveBehavior(req(CAPTIONS.box, "road"), "road").behavior.kind).toBe("slow_down");
    expect(resolveBehavior(req(CAPTIONS.leaves, "road"), "road").behavior.kind).toBe("continue");
    expect(resolveBehavior(req(CAPTIONS.child, "sidewalk"), "sidewalk").behavior.kind).toBe("continue");
  });
});

describe("Game", () => {
  it("stops for a person on the road and stays stopped until removed", () => {
    const game = new Game();
    const id = addDecided(game, "road", 50, CAPTIONS.child);
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const obj = game.get(id)!;
    expect(game.distanceAhead(obj)).toBeGreaterThan(0);
    expect(obj.status).toBe("decided");
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("waits 2 s at a stop sign, then continues", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 50, CAPTIONS.stop);
    let stoppedFor = 0;
    run(game, 15, () => {
      if (game.speedMs === 0) stoppedFor += 1 / 120;
    });
    expect(stoppedFor).toBeGreaterThanOrEqual(2);
    expect(stoppedFor).toBeLessThan(2.3);
    expect(game.get(id)?.passed ?? true).toBe(true);
  });

  it("holds at a red light until a green light is dropped", () => {
    const game = new Game();
    const red = addDecided(game, "sidewalk", 50, CAPTIONS.red);
    run(game, 15);
    expect(game.speedMs).toBe(0);
    addDecided(game, "sidewalk", 30, CAPTIONS.green);
    expect(game.get(red)!.released).toBe(true);
    run(game, 5);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("slows to half the target for a minor obstacle, then recovers", () => {
    const game = new Game();
    addDecided(game, "road", 60, CAPTIONS.box);
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(25, 0);
    run(game, 15);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("applies a speed limit when passing the sign", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, CAPTIONS.limit30);
    expect(game.baseTargetKmh).toBe(50);
    run(game, 8);
    expect(game.baseTargetKmh).toBe(30);
    expect(kmh(game)).toBeCloseTo(30, 0);
  });

  it("ignores a person on the sidewalk", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, CAPTIONS.child);
    run(game, 6);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("reacts too late when the car reaches an undecided road object", () => {
    const game = new Game();
    const tooLate: unknown[] = [];
    game.events.on("tooLate", (e) => tooLate.push(e));
    const id = add(game, "road", 10);
    run(game, 2);
    expect(game.get(id)!.status).toBe("too_late");
    expect(game.speedMs).toBe(0);
    expect(tooLate).toHaveLength(1);

    // A late decision is recorded but doesn't clear the state.
    game.setCaption(id, CAPTIONS.leaves, 0);
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, cannedAnswer({ ...t }, 0));
    expect(game.get(id)!.status).toBe("too_late");

    game.removeObject(id);
    expect(tooLate.at(-1)).toBeNull();
    run(game, 2);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("does not count undecided sidewalk objects as too late", () => {
    const game = new Game();
    const id = add(game, "sidewalk", 10);
    run(game, 2);
    expect(game.get(id)!.status).toBe("perceiving");
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("re-decides an object dragged from the road to the sidewalk", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "road", 50, CAPTIONS.child);
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const y = game.sToScreenY(game.get(id)!.s);
    game.startDrag(id, ROAD_LEFT + 20, y);
    game.endDrag(id, 40, y, true);
    expect(needs).toEqual([id]);
    expect(game.get(id)!.zone).toBe("sidewalk");
    expect(game.get(id)!.status).toBe("perceiving");
    run(game, 3);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("drops a stale decision after the object moved zones", () => {
    const game = new Game();
    const id = add(game, "road", 60);
    game.setCaption(id, CAPTIONS.child, 0);
    const t = game.beginDecision(id)!;
    const y = game.sToScreenY(game.get(id)!.s);
    game.startDrag(id, 200, y);
    game.endDrag(id, 40, y, true);
    game.applyDecision(id, t.seq, cannedAnswer({ ...t }, 0));
    expect(game.get(id)!.response).toBeUndefined();
  });
});
