import { describe, expect, it } from "vitest";
import type { Category, ChoiceAnswer, DecideResponse, LightState, SpeedLimit } from "../../shared/types";
import { resolveBehavior } from "./behaviors";
import { OBJECT_HALF_LENGTH_M, PX_PER_M, ROAD_LEFT, ROAD_MID, ROAD_RIGHT } from "./constants";
import { Game } from "./engine";
import { msToKmh } from "./physics";
import { ZONES, type Zone } from "./types";

const fakeImage = {} as HTMLImageElement;

interface Fake {
  category: Category;
  light?: LightState;
  limit?: SpeedLimit;
  couldBePerson?: number;
  mentionsChild?: number;
}

// Hand-written answers for the engine tests (Jev itself is never called here).
// Jev only sees the caption, so an answer is the same in every zone.
const FAKES: Record<string, Fake> = {
  child: { category: "person", couldBePerson: 0.95, mentionsChild: 0.99 },
  adult: { category: "person", couldBePerson: 0.9 },
  teddy: { category: "obstacle", couldBePerson: 0.7 },
  doll: { category: "obstacle", couldBePerson: 0.7, mentionsChild: 0.6 }, // "a child's doll"
  dog: { category: "animal" },
  car: { category: "vehicle" },
  box: { category: "obstacle" },
  leaves: { category: "harmless_debris" },
  vague: { category: "unclear" },
  stop: { category: "stop_sign" },
  red: { category: "traffic_light", light: "red" },
  green: { category: "traffic_light", light: "green" },
  unlit: { category: "traffic_light", light: "unknown" },
  limit30: { category: "speed_limit_sign", limit: "30" },
};

const pick = <T extends string>(choice: T): ChoiceAnswer<T> =>
  ({ choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }) as ChoiceAnswer<T>;

function answer(name: string): DecideResponse {
  const f = FAKES[name]!;
  return {
    category: pick(f.category),
    lightState: pick(f.light ?? "not_a_light"),
    speedLimit: pick(f.limit ?? "none"),
    couldBePerson: f.couldBePerson ?? 0.01,
    mentionsChild: f.mentionsChild ?? 0.01,
    latencyMs: 0,
  };
}

/** A screen column in the middle of each zone. */
const ZONE_X: Record<Zone, number> = {
  own_lane: (ROAD_MID + ROAD_RIGHT) / 2,
  oncoming_lane: (ROAD_LEFT + ROAD_MID) / 2,
  sidewalk: 40,
};

/** Add an object whose near edge is `ahead` metres in front of the car. */
function add(game: Game, zone: Zone, ahead: number): string {
  const y = game.carFrontY - (ahead + OBJECT_HALF_LENGTH_M) * PX_PER_M;
  return game.addObject(fakeImage, "", ZONE_X[zone], y);
}

/** Add an object and immediately give it the fake answer `name`. */
function addDecided(game: Game, zone: Zone, ahead: number, name: string): string {
  const id = add(game, zone, ahead);
  game.setCaption(id, `caption of ${name}`, 0);
  const t = game.beginDecision(id)!;
  game.applyDecision(id, t.seq, answer(name));
  return id;
}

/** Drag an object sideways into `zone`, or to `ahead` metres in front of the car. */
function move(game: Game, id: string, zone: Zone, ahead?: number): void {
  const obj = game.get(id)!;
  const y = ahead === undefined ? game.sToScreenY(obj.s) : game.carFrontY - (ahead + OBJECT_HALF_LENGTH_M) * PX_PER_M;
  game.startDrag(id, obj.x, game.sToScreenY(obj.s));
  game.endDrag(id, ZONE_X[zone], y, true);
}

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds * 120; i++) {
    game.update(1 / 120);
    each?.();
  }
}

const kmh = (game: Game) => msToKmh(game.speedMs);
const kind = (game: Game, id: string) => game.get(id)!.decision?.resolved.behavior.kind;

describe("zoneAt", () => {
  it("splits the road at the centre line; the car drives in the right lane", () => {
    const game = new Game();
    expect(game.zoneAt(ROAD_LEFT - 1)).toBe("sidewalk");
    expect(game.zoneAt(ROAD_LEFT + 1)).toBe("oncoming_lane");
    expect(game.zoneAt(ROAD_MID - 1)).toBe("oncoming_lane");
    expect(game.zoneAt(ROAD_MID)).toBe("own_lane");
    expect(game.zoneAt(ROAD_RIGHT)).toBe("own_lane");
    expect(game.zoneAt(ROAD_RIGHT + 1)).toBe("sidewalk");
  });
});

describe("resolveBehavior", () => {
  const kinds = (res: DecideResponse) => ZONES.map((zone) => resolveBehavior(res, zone).behavior.kind);

  // The behavior table in docs/SPEC.md, one row per case: own lane, oncoming lane, sidewalk.
  it.each([
    ["child", ["stop", "stop", "slow_down"]],
    ["adult", ["stop", "slow_down", "continue"]],
    ["dog", ["stop", "slow_down", "continue"]],
    ["car", ["stop", "continue", "continue"]],
    ["box", ["stop", "continue", "continue"]],
    ["leaves", ["continue", "continue", "continue"]],
    ["vague", ["stop", "slow_down", "continue"]],
  ])("follows the table for %s", (name, expected) => {
    expect(kinds(answer(name))).toEqual(expected);
  });

  it("names what it is, where, and what the car does", () => {
    expect(resolveBehavior(answer("child"), "sidewalk").label).toBe("Child on the sidewalk, slow down until passed");
    expect(resolveBehavior(answer("car"), "oncoming_lane").label).toBe("Vehicle in the oncoming lane, continue");
    expect(resolveBehavior(answer("adult"), "own_lane").label).toBe("Person in your lane, stop until cleared");
  });

  it("counts people as children once the caption mentions a child", () => {
    expect(kinds({ ...answer("adult"), mentionsChild: 0.3 })).toEqual(["stop", "stop", "slow_down"]);
    expect(kinds({ ...answer("adult"), mentionsChild: 0.1 })).toEqual(["stop", "slow_down", "continue"]);
    expect(resolveBehavior(answer("child"), "sidewalk").safetyOverride).toBe(false);
  });

  it("treats anything that could be a person as one, flagged only when that changes the outcome", () => {
    expect(resolveBehavior(answer("teddy"), "own_lane")).toMatchObject({
      behavior: { kind: "stop" },
      safetyOverride: false, // an obstacle in the lane stops the car anyway
    });
    expect(resolveBehavior(answer("teddy"), "oncoming_lane")).toMatchObject({
      behavior: { kind: "slow_down" },
      safetyOverride: true,
      label: "Slow down until passed: it could be a person (instead of: obstacle in the oncoming lane, continue)",
    });
    expect(resolveBehavior(answer("teddy"), "sidewalk").safetyOverride).toBe(false);
  });

  it("treats a look-alike whose caption mentions a child as a child", () => {
    expect(kinds(answer("doll"))).toEqual(["stop", "stop", "slow_down"]);
    expect(resolveBehavior(answer("doll"), "sidewalk")).toMatchObject({
      safetyOverride: true,
      label: expect.stringContaining("it could be a child") as unknown,
    });
  });

  it("maps signs and lights by category, in every zone", () => {
    for (const zone of ZONES) {
      expect(resolveBehavior(answer("stop"), zone).behavior.kind).toBe("stop_sign");
      expect(resolveBehavior(answer("red"), zone).behavior).toEqual({ kind: "red_light", light: "red" });
      expect(resolveBehavior(answer("green"), zone).behavior.kind).toBe("green_light");
      expect(resolveBehavior(answer("limit30"), zone).behavior).toEqual({ kind: "speed_limit", kmh: 30 });
    }
  });

  it("keeps speed for a speed limit sign without a readable number", () => {
    const res = { ...answer("limit30"), speedLimit: pick<SpeedLimit>("none") };
    expect(resolveBehavior(res, "own_lane").behavior.kind).toBe("continue");
  });

  it("slows down for a traffic light whose colour is unknown", () => {
    expect(resolveBehavior(answer("unlit"), "own_lane").behavior.kind).toBe("slow_down");
  });
});

describe("Game", () => {
  it("removes an object through its × button hit area", () => {
    const game = new Game();
    const id = add(game, "own_lane", 20);
    const c = game.removeButtonCenter(game.get(id)!);
    expect(game.hitTestRemove(c.x, c.y)).toBe(id);
    const obj = game.get(id)!;
    expect(game.hitTestRemove(obj.x, game.sToScreenY(obj.s))).toBeNull();
  });

  it("stops for a person in its lane and stays stopped until removed", () => {
    const game = new Game();
    const id = addDecided(game, "own_lane", 50, "adult");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const obj = game.get(id)!;
    expect(game.distanceAhead(obj)).toBeGreaterThan(0);
    expect(obj.phase.kind).toBe("decided");
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("stops for a child in the oncoming lane and waits until it is removed", () => {
    const game = new Game();
    const id = addDecided(game, "oncoming_lane", 50, "child");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    expect(game.distanceAhead(game.get(id)!)).toBeGreaterThan(0);
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("slows to half the target for an adult in the oncoming lane until passed, then recovers", () => {
    const game = new Game();
    const id = addDecided(game, "oncoming_lane", 60, "adult");
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(25, 0);
    // Still slow while alongside it, not only up to its front edge.
    while (game.distanceAhead(game.get(id)!) > -2) game.update(1 / 120);
    expect(kmh(game)).toBeCloseTo(25, 0);
    run(game, 15);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("slows down for a child on the sidewalk but not for an adult", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, "adult");
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(50, 0);
    addDecided(game, "sidewalk", 40, "child");
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(25, 0);
  });

  it("ignores a car and an obstacle in the oncoming lane", () => {
    const game = new Game();
    addDecided(game, "oncoming_lane", 30, "car");
    addDecided(game, "oncoming_lane", 50, "box");
    run(game, 8);
    expect(kmh(game)).toBeCloseTo(50, 0);
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

  it("applies a speed limit when passing the sign", () => {
    const game = new Game();
    addDecided(game, "sidewalk", 40, "limit30");
    expect(game.baseTargetKmh).toBe(50);
    run(game, 8);
    expect(game.baseTargetKmh).toBe(30);
    expect(kmh(game)).toBeCloseTo(30, 0);
  });

  it("reacts too late when the car reaches an undecided object in its lane", () => {
    const game = new Game();
    const id = add(game, "own_lane", 10);
    run(game, 2);
    expect(game.get(id)!.phase.kind).toBe("too_late");
    expect(game.speedMs).toBe(0);
    expect(game.ui.getState().tooLate).toEqual({ id, reason: "The car reached it before a decision arrived." });

    // A late decision is recorded but doesn't clear the state.
    game.setCaption(id, "caption of leaves", 0);
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, answer("leaves"));
    expect(game.get(id)!.phase.kind).toBe("too_late");
    expect(kind(game, id)).toBe("continue");

    game.removeObject(id);
    expect(game.ui.getState().tooLate).toBeNull();
    run(game, 2);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it.each(["oncoming_lane", "sidewalk"] as const)("does not count undecided objects in the %s as too late", (zone) => {
    const game = new Game();
    const id = add(game, zone, 10);
    run(game, 2);
    expect(game.get(id)!.phase.kind).toBe("passed"); // not "too_late"
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("treats a failed decision like an unclear object: stop in the lane until removed", () => {
    const game = new Game();
    const ids = ZONES.map((zone, i) => {
      const id = add(game, zone, 50 - i * 10);
      game.setCaption(id, "anything", 0);
      game.failDecision(id, game.beginDecision(id)!.seq);
      return id;
    });
    expect(ids.map((id) => kind(game, id))).toEqual(["stop", "slow_down", "continue"]);
    run(game, 10);
    expect(game.speedMs).toBe(0);
    game.removeObject(ids[0]!);
    run(game, 3);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("resolves a moved object again without asking Jev", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "own_lane", 50, "child");
    run(game, 10);
    expect(game.speedMs).toBe(0);

    move(game, id, "sidewalk");
    expect(game.get(id)!.zone).toBe("sidewalk");
    expect(game.get(id)!.phase.kind).toBe("decided");
    expect(kind(game, id)).toBe("slow_down");
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);

    move(game, id, "oncoming_lane");
    expect(kind(game, id)).toBe("stop");
    expect(needs).toEqual([]);
  });

  it("applies an answer to wherever the object is when it arrives", () => {
    const game = new Game();
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const t = game.beginDecision(id)!;
    move(game, id, "sidewalk");
    expect(game.get(id)!.phase.kind).toBe("deciding");
    game.applyDecision(id, t.seq, answer("child"));
    expect(game.get(id)!.phase.kind).toBe("decided");
    expect(kind(game, id)).toBe("slow_down");
  });

  it("ignores an answer that arrives after the object was removed", () => {
    const game = new Game();
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const t = game.beginDecision(id)!;
    game.removeObject(id);
    game.applyDecision(id, t.seq, answer("child"));
    expect(game.get(id)).toBeUndefined();
  });

  it("retries a failed request when the object is moved to another zone", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const first = game.beginDecision(id)!;
    game.failDecision(id, first.seq);
    move(game, id, "oncoming_lane");
    expect(needs).toEqual([id]);
    expect(game.get(id)!.phase.kind).toBe("deciding");
    expect(game.get(id)!.decision).toBeUndefined();
    const retry = game.beginDecision(id)!;
    expect(retry.seq).not.toBe(first.seq);
    game.applyDecision(id, retry.seq, answer("child"));
    expect(kind(game, id)).toBe("stop");
  });

  it("obeys a passed object that is dragged back into the lane ahead", () => {
    // Regression: `passed` used to survive the move, so the car ignored it.
    const game = new Game();
    const id = addDecided(game, "sidewalk", 20, "child");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);

    move(game, id, "own_lane", 40);
    const obj = game.get(id)!;
    expect(obj.phase.kind).toBe("decided");
    expect(kind(game, id)).toBe("stop");
    run(game, 10);
    expect(game.speedMs).toBe(0);
  });

  it("starts over for a passed stop sign moved ahead within the same zone", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 20, "stop");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);
    expect(game.get(id)!.decision!.released).toBe(true);
    move(game, id, "sidewalk", 40);
    const obj = game.get(id)!;
    expect(obj.phase.kind).toBe("decided");
    expect(obj.decision).toMatchObject({ resolved: { behavior: { kind: "stop_sign" } }, released: false });
  });

  it("stops for an object in its lane the vision model couldn't caption, until it is moved", () => {
    const game = new Game();
    const lane = add(game, "own_lane", 50);
    const side = add(game, "sidewalk", 30);
    game.failPerception(lane);
    game.failPerception(side);
    expect(game.get(lane)!.phase.kind).toBe("decided");
    expect(game.get(lane)!.decision).toMatchObject({
      resolved: { behavior: { kind: "stop" } },
      outcome: { kind: "failed", stage: "perception" },
    });
    expect(kind(game, side)).toBe("continue");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    expect(game.get(lane)!.phase.kind).toBe("decided"); // not "too late": it wasn't slow, it failed

    // Moved to the sidewalk it no longer blocks; there's no caption to ask with.
    move(game, lane, "sidewalk");
    expect(kind(game, lane)).toBe("continue");
    run(game, 3);
    expect(game.speedMs).toBeGreaterThan(0);
  });

  it("keeps a removed card in place and forgets the object", () => {
    const game = new Game();
    const first = add(game, "own_lane", 40);
    add(game, "own_lane", 50);
    const before = game.ui.getState().cards.map((c) => c.id);
    game.removeObject(first);
    const { cards } = game.ui.getState();
    expect(cards.map((c) => c.id)).toEqual(before);
    expect(cards.find((c) => c.id === first)?.phase.kind).toBe("removed");
    expect(game.get(first)).toBeUndefined();
  });

  it("publishes UI state only on events, newest card first", () => {
    const game = new Game();
    let updates = 0;
    game.ui.subscribe(() => updates++);
    const a = add(game, "sidewalk", 60);
    const b = add(game, "sidewalk", 70);
    expect(game.ui.getState().cards.map((c) => c.id)).toEqual([b, a]);
    updates = 0;
    run(game, 1); // 120 frames, nothing passed or decided
    expect(updates).toBe(0);
    game.setBaseTarget(80);
    expect(game.ui.getState().targetKmh).toBe(80);
  });
});
