import { describe, expect, it } from "vitest";
import type { Action, Category, ChoiceAnswer, DecideResponse, LightState, SpeedLimit, Zone } from "../../shared/types";
import { resolveBehavior } from "./behaviors";
import { OBJECT_HALF_LENGTH_M, PX_PER_M, ROAD_LEFT, ROAD_RIGHT } from "./constants";
import { Game } from "./engine";
import { distanceBand, kmhToMs, msToKmh } from "./physics";

const fakeImage = {} as HTMLImageElement;

interface Fake {
  category: Category;
  road: Action;
  sidewalk?: Action;
  light?: LightState;
  limit?: SpeedLimit;
  couldBePerson?: number;
}

// Hand-written answers for the engine tests (Jev itself is never called here).
const FAKES: Record<string, Fake> = {
  child: { category: "person", road: "stop", couldBePerson: 0.95 },
  teddy: { category: "obstacle", road: "slow_down", couldBePerson: 0.34 },
  stop: { category: "stop_sign", road: "stop" },
  red: { category: "traffic_light", road: "stop", light: "red" },
  green: { category: "traffic_light", road: "continue", light: "green" },
  unlit: { category: "traffic_light", road: "slow_down", light: "unknown" },
  limit30: { category: "speed_limit_sign", road: "continue", limit: "30" },
  box: { category: "obstacle", road: "slow_down" },
  leaves: { category: "harmless_debris", road: "continue" },
};

const pick = <T extends string>(choice: T): ChoiceAnswer<T> =>
  ({ choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }) as ChoiceAnswer<T>;

function answer(name: string, zone: Zone): DecideResponse {
  const f = FAKES[name]!;
  return {
    category: pick(f.category),
    action: pick(zone === "road" ? f.road : (f.sidewalk ?? "continue")),
    lightState: pick(f.light ?? "not_a_light"),
    speedLimit: pick(f.limit ?? "none"),
    couldBePerson: f.couldBePerson ?? 0.01,
    latencyMs: 0,
  };
}

/** Add an object whose near edge is `ahead` metres in front of the car. */
function add(game: Game, zone: Zone, ahead: number): string {
  const x = zone === "road" ? (ROAD_LEFT + ROAD_RIGHT) / 2 : 40;
  const y = game.carFrontY - (ahead + OBJECT_HALF_LENGTH_M) * PX_PER_M;
  return game.addObject(fakeImage, "", x, y);
}

/** Add an object and immediately give it the fake decision `name`. */
function addDecided(game: Game, zone: Zone, ahead: number, name: string): string {
  const id = add(game, zone, ahead);
  game.setCaption(id, `caption of ${name}`, 0);
  const t = game.beginDecision(id)!;
  game.applyDecision(id, t.seq, answer(name, t.zone));
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
    const v = kmhToMs(50); // comfortable stop ≈ 13.8 m
    expect(distanceBand(60, v)).toBe("far");
    expect(distanceBand(25, v)).toBe("medium");
    expect(distanceBand(12, v)).toBe("near");
    expect(distanceBand(15, kmhToMs(20))).toBe("far");
  });
});

describe("resolveBehavior", () => {
  const req = answer;

  it("applies the safety override only on the road", () => {
    expect(resolveBehavior(req("teddy", "road"), "road")).toMatchObject({
      behavior: { kind: "stop" },
      safetyOverride: true,
    });
    expect(resolveBehavior(req("teddy", "sidewalk"), "sidewalk").safetyOverride).toBe(false);
  });

  it("doesn't flag the override when Jev already said stop", () => {
    expect(resolveBehavior(req("child", "road"), "road")).toMatchObject({
      behavior: { kind: "stop" },
      safetyOverride: false,
    });
  });

  it("maps signs and lights by category", () => {
    expect(resolveBehavior(req("stop", "road"), "road").behavior.kind).toBe("stop_sign");
    expect(resolveBehavior(req("red", "sidewalk"), "sidewalk").behavior).toEqual({ kind: "red_light", light: "red" });
    expect(resolveBehavior(req("green", "sidewalk"), "sidewalk").behavior.kind).toBe("green_light");
    expect(resolveBehavior(req("limit30", "sidewalk"), "sidewalk").behavior).toEqual({ kind: "speed_limit", kmh: 30 });
  });

  it("falls back to the action", () => {
    expect(resolveBehavior(req("box", "road"), "road").behavior.kind).toBe("slow_down");
    expect(resolveBehavior(req("leaves", "road"), "road").behavior.kind).toBe("continue");
    expect(resolveBehavior(req("child", "sidewalk"), "sidewalk").behavior.kind).toBe("continue");
  });

  it("keeps speed for a speed limit sign without a readable number", () => {
    const res = { ...req("limit30", "road"), speedLimit: pick<SpeedLimit>("none") };
    expect(resolveBehavior(res, "road").behavior.kind).toBe("continue");
  });

  it("slows down for a traffic light whose colour is unknown", () => {
    expect(resolveBehavior(req("unlit", "road"), "road").behavior.kind).toBe("slow_down");
  });
});

describe("Game", () => {
  it("removes an object through its × button hit area", () => {
    const game = new Game();
    const id = add(game, "road", 20);
    const c = game.removeButtonCenter(game.get(id)!);
    expect(game.hitTestRemove(c.x, c.y)).toBe(id);
    const obj = game.get(id)!;
    expect(game.hitTestRemove(obj.x, game.sToScreenY(obj.s))).toBeNull();
  });

  it("stops for a person on the road and stays stopped until removed", () => {
    const game = new Game();
    const id = addDecided(game, "road", 50, "child");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const obj = game.get(id)!;
    expect(game.distanceAhead(obj)).toBeGreaterThan(0);
    expect(obj.phase.kind).toBe("decided");
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("waits 2 s at a stop sign, then continues", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 50, "stop");
    let stoppedFor = 0;
    run(game, 15, () => {
      if (game.speedMs === 0) stoppedFor += 1 / 120;
    });
    expect(stoppedFor).toBeGreaterThanOrEqual(2 - 1e-9); // summed frame times drift slightly
    expect(stoppedFor).toBeLessThan(2.3);
    expect(game.get(id)?.phase.kind ?? "scrolled off").toMatch(/passed|scrolled off/);
  });

  it("holds at a red light until a green light is dropped", () => {
    const game = new Game();
    const red = addDecided(game, "sidewalk", 50, "red");
    run(game, 15);
    expect(game.speedMs).toBe(0);
    addDecided(game, "sidewalk", 30, "green");
    expect(game.get(red)!.decision!.released).toBe(true);
    run(game, 5);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("slows to half the target for a minor obstacle, then recovers", () => {
    const game = new Game();
    addDecided(game, "road", 60, "box");
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(25, 0);
    run(game, 15);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("applies a speed limit when passing the sign", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, "limit30");
    expect(game.baseTargetKmh).toBe(50);
    run(game, 8);
    expect(game.baseTargetKmh).toBe(30);
    expect(kmh(game)).toBeCloseTo(30, 0);
  });

  it("ignores a person on the sidewalk", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, "child");
    run(game, 6);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("reacts too late when the car reaches an undecided road object", () => {
    const game = new Game();
    const tooLate: unknown[] = [];
    game.events.on("tooLate", (e) => tooLate.push(e));
    const id = add(game, "road", 10);
    run(game, 2);
    expect(game.get(id)!.phase.kind).toBe("too_late");
    expect(game.speedMs).toBe(0);
    expect(tooLate).toHaveLength(1);

    // A late decision is recorded but doesn't clear the state.
    game.setCaption(id, "caption of leaves", 0);
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, answer("leaves", t.zone));
    expect(game.get(id)!.phase.kind).toBe("too_late");
    expect(game.get(id)!.decision?.resolved.behavior.kind).toBe("continue");

    game.removeObject(id);
    expect(tooLate.at(-1)).toBeNull();
    run(game, 2);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("stops for a road object whose decision failed, until it is removed", () => {
    const game = new Game();
    const road = add(game, "road", 50);
    game.setCaption(road, "anything", 0);
    game.failDecision(road, game.beginDecision(road)!.seq);
    const side = add(game, "sidewalk", 30);
    game.setCaption(side, "anything", 0);
    game.failDecision(side, game.beginDecision(side)!.seq);
    expect(game.get(road)!.decision!.resolved.behavior.kind).toBe("stop");
    expect(game.get(side)!.decision!.resolved.behavior.kind).toBe("continue");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    game.removeObject(road);
    run(game, 2);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("does not count undecided sidewalk objects as too late", () => {
    const game = new Game();
    const id = add(game, "sidewalk", 10);
    run(game, 2);
    expect(game.get(id)!.phase.kind).toBe("passed"); // not "too_late"
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("re-decides an object dragged from the road to the sidewalk", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "road", 50, "child");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const y = game.sToScreenY(game.get(id)!.s);
    game.startDrag(id, ROAD_LEFT + 20, y);
    game.endDrag(id, 40, y, true);
    expect(needs).toEqual([id]);
    expect(game.get(id)!.zone).toBe("sidewalk");
    expect(game.get(id)!.phase.kind).toBe("deciding");
    run(game, 3);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("drops a stale decision after the object moved zones", () => {
    const game = new Game();
    const id = add(game, "road", 60);
    game.setCaption(id, "caption of child", 0);
    const t = game.beginDecision(id)!;
    const y = game.sToScreenY(game.get(id)!.s);
    game.startDrag(id, 200, y);
    game.endDrag(id, 40, y, true);
    game.applyDecision(id, t.seq, answer("child", t.zone));
    expect(game.get(id)!.decision).toBeUndefined();
  });

  it("obeys a passed object that is dragged back onto the road ahead", () => {
    // Regression: `passed` used to survive the move, so the car ignored it.
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "sidewalk", 20, "child");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);

    const obj = game.get(id)!;
    game.startDrag(id, obj.x, game.sToScreenY(obj.s));
    game.endDrag(id, (ROAD_LEFT + ROAD_RIGHT) / 2, game.carFrontY - 40 * PX_PER_M, true);
    expect(needs).toEqual([id]);
    expect(obj.phase.kind).toBe("deciding");
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, answer("child", t.zone));
    run(game, 10);
    expect(game.speedMs).toBe(0);
    expect(obj.phase.kind).toBe("decided");
  });

  it("re-decides a passed object moved ahead within the same zone", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 20, "stop");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);
    const obj = game.get(id)!;
    game.startDrag(id, obj.x, game.sToScreenY(obj.s));
    game.endDrag(id, 40, game.carFrontY - 40 * PX_PER_M, true);
    expect(obj.phase.kind).toBe("deciding");
    expect(obj.decision).toBeUndefined();
  });

  it("stops for a road object the vision model couldn't caption, until it is removed", () => {
    const game = new Game();
    const road = add(game, "road", 50);
    const side = add(game, "sidewalk", 30);
    game.failPerception(road);
    game.failPerception(side);
    expect(game.get(road)!.phase.kind).toBe("decided");
    expect(game.get(road)!.decision).toMatchObject({
      resolved: { behavior: { kind: "stop" } },
      outcome: { kind: "failed", stage: "perception" },
    });
    expect(game.get(side)!.decision!.resolved.behavior.kind).toBe("continue");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    expect(game.get(road)!.phase.kind).toBe("decided"); // not "too late": it wasn't slow, it failed

    // Moved to the sidewalk it no longer blocks; there's no caption to re-ask with.
    const obj = game.get(road)!;
    game.startDrag(road, obj.x, game.sToScreenY(obj.s));
    game.endDrag(road, 40, game.sToScreenY(obj.s), true);
    expect(obj.decision!.resolved.behavior.kind).toBe("continue");
    run(game, 3);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("keeps a removed card in place and forgets the object", () => {
    const game = new Game();
    const snaps: { phase: string; addedAt: number }[] = [];
    game.events.on("object", (o) => snaps.push({ phase: o.phase.kind, addedAt: o.addedAt }));
    const id = add(game, "road", 40);
    game.removeObject(id);
    expect(snaps.at(-1)).toEqual({ phase: "removed", addedAt: snaps[0]!.addedAt });
    expect(game.get(id)).toBeUndefined();
  });
});
