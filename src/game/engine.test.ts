import { describe, expect, it } from "vitest";
import type { Action, Category, ChoiceAnswer, DecideResponse, SpeedLimit } from "../../shared/types";
import { failedBehavior, resolveBehavior } from "./behaviors";
import { OBJECT_HALF_LENGTH_M, PX_PER_M, ROAD_LEFT, ROAD_MID, ROAD_RIGHT } from "./constants";
import { Game } from "./engine";
import { msToKmh } from "./physics";
import { ZONES, type Zone } from "./types";

const fakeImage = {} as HTMLImageElement;

interface Fake {
  action: Action;
  category: Category;
  limit?: SpeedLimit;
}

// Hand-written answers for the engine tests (Jev itself is never called here).
// Jev decides per zone; each fake is one answer the game has to carry out.
const FAKES: Record<string, Fake> = {
  stop: { action: "stop", category: "person" },
  slow: { action: "slow_down", category: "person" },
  ignore: { action: "continue", category: "harmless_debris" },
  stop_sign: { action: "stop_then_go", category: "stop_sign" },
  red: { action: "wait_for_green", category: "traffic_light" },
  green: { action: "go", category: "traffic_light" },
  limit30: { action: "change_speed", category: "speed_limit_sign", limit: "30" },
};

const pick = <T extends string>(choice: T): ChoiceAnswer<T> =>
  ({ choice, confidence: 0.9, probabilities: { [choice]: 0.9 } }) as ChoiceAnswer<T>;

function answer(name: string): DecideResponse {
  const f = FAKES[name]!;
  return {
    action: pick(f.action),
    category: pick(f.category),
    speedLimit: pick(f.limit ?? "none"),
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
  it.each([
    ["stop", { kind: "stop" }],
    ["slow", { kind: "slow_down" }],
    ["ignore", { kind: "continue" }],
    ["stop_sign", { kind: "stop_sign" }],
    ["red", { kind: "red_light" }],
    ["green", { kind: "green_light" }],
    ["limit30", { kind: "speed_limit", kmh: 30 }],
  ])("carries out Jev's action for %s, whatever the zone", (name, behavior) => {
    for (const zone of ZONES) expect(resolveBehavior(answer(name), zone).behavior).toEqual(behavior);
  });

  it("names what Jev thinks it is, where, and what the car does", () => {
    expect(resolveBehavior(answer("stop"), "own_lane").label).toBe("Person in your lane: stop until cleared");
    expect(resolveBehavior(answer("slow"), "sidewalk").label).toBe("Person on the sidewalk: slow down until passed");
    expect(resolveBehavior(answer("limit30"), "sidewalk").label).toBe(
      "Speed limit sign on the sidewalk: change speed to 30 km/h",
    );
  });

  it("keeps speed when Jev says change speed but read no number", () => {
    const res = { ...answer("limit30"), speedLimit: pick<SpeedLimit>("none") };
    expect(resolveBehavior(res, "own_lane")).toEqual({
      behavior: { kind: "continue" },
      label: "Speed limit sign in your lane: change speed, no number read: keep speed",
    });
  });

  it("without an answer, stops in the lane, slows beside it and ignores the sidewalk", () => {
    expect(ZONES.map((zone) => failedBehavior(zone, "decision").behavior.kind)).toEqual([
      "stop",
      "slow_down",
      "continue",
    ]);
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

  it("stops when Jev says stop and stays stopped until removed", () => {
    const game = new Game();
    const id = addDecided(game, "own_lane", 50, "stop");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    const obj = game.get(id)!;
    expect(game.distanceAhead(obj)).toBeGreaterThan(0);
    expect(obj.phase.kind).toBe("decided");
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("stops for an object in the oncoming lane when Jev says so", () => {
    const game = new Game();
    const id = addDecided(game, "oncoming_lane", 50, "stop");
    run(game, 10);
    expect(game.speedMs).toBe(0);
    expect(game.distanceAhead(game.get(id)!)).toBeGreaterThan(0);
    game.removeObject(id);
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("slows to half the target until passed, then recovers", () => {
    const game = new Game();
    const id = addDecided(game, "oncoming_lane", 60, "slow");
    run(game, 3);
    expect(kmh(game)).toBeCloseTo(25, 0);
    // Still slow while alongside it, not only up to its front edge.
    while (game.distanceAhead(game.get(id)!) > -2) game.update(1 / 120);
    expect(kmh(game)).toBeCloseTo(25, 0);
    run(game, 15);
    expect(kmh(game)).toBeCloseTo(50, 0);
  });

  it("drives on when Jev says continue, even in its lane", () => {
    const game = new Game();
    addDecided(game, "own_lane", 30, "ignore");
    addDecided(game, "oncoming_lane", 50, "ignore");
    run(game, 8);
    expect(kmh(game)).toBeCloseTo(50, 0);
    expect(game.ui.getState().tooLate).toBeNull();
  });

  it("waits 2 s at a stop sign, then continues", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 50, "stop_sign");
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
    game.applyDecision(id, t.seq, answer("ignore"));
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

  it("without an answer from Jev, stops in the lane until removed", () => {
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

  it("asks Jev again when an object moves to another zone; the old decision holds until it answers", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "own_lane", 50, "stop");
    run(game, 10);
    expect(game.speedMs).toBe(0);

    move(game, id, "sidewalk");
    expect(needs).toEqual([id]);
    const obj = game.get(id)!;
    expect(obj.zone).toBe("sidewalk");
    expect(obj.phase.kind).toBe("deciding");
    run(game, 3);
    expect(game.speedMs).toBe(0); // still Jev's stop

    const t = game.beginDecision(id)!;
    expect(t.zone).toBe("sidewalk");
    game.applyDecision(id, t.seq, answer("ignore"));
    expect(game.get(id)!.phase.kind).toBe("decided");
    run(game, 3);
    expect(kmh(game)).toBeGreaterThan(20);
  });

  it("asks Jev again when an object moves within its zone", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "own_lane", 50, "stop");
    move(game, id, "own_lane", 60);
    expect(needs).toEqual([id]);
    expect(game.get(id)!.phase.kind).toBe("deciding");
    expect(kind(game, id)).toBe("stop"); // holds until Jev answers
  });

  it("doesn't ask again for a click without a move", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = addDecided(game, "own_lane", 50, "stop");
    const obj = game.get(id)!;
    const y = game.sToScreenY(obj.s);
    game.startDrag(id, obj.x, y);
    game.endDrag(id, obj.x + 2, y + 1, true);
    expect(needs).toEqual([]);
    expect(obj.phase.kind).toBe("decided");
  });

  it("reacts too late when the car reaches a moved object before Jev answers again", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 10, "ignore");
    move(game, id, "own_lane");
    run(game, 2);
    expect(game.get(id)!.phase.kind).toBe("too_late");
  });

  it("drops an answer for the zone an object has left and asks for the new one", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const first = game.beginDecision(id)!;
    move(game, id, "sidewalk");
    expect(needs).toEqual([id]);
    game.applyDecision(id, first.seq, answer("stop"));
    expect(game.get(id)!.phase.kind).toBe("deciding");

    const second = game.beginDecision(id)!;
    expect(second).toMatchObject({ zone: "sidewalk" });
    game.applyDecision(id, second.seq, answer("slow"));
    expect(kind(game, id)).toBe("slow_down");
  });

  it("ignores an answer that arrives after the object was removed", () => {
    const game = new Game();
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const t = game.beginDecision(id)!;
    game.removeObject(id);
    game.applyDecision(id, t.seq, answer("stop"));
    expect(game.get(id)).toBeUndefined();
  });

  it("retries a failed request when the object is moved, even within its zone", () => {
    const game = new Game();
    const needs: string[] = [];
    game.events.on("needsDecision", ({ id }) => needs.push(id));
    const id = add(game, "own_lane", 60);
    game.setCaption(id, "caption of child", 0);
    const first = game.beginDecision(id)!;
    game.failDecision(id, first.seq);
    move(game, id, "own_lane", 70);
    expect(needs).toEqual([id]);
    expect(game.get(id)!.phase.kind).toBe("deciding");
    const retry = game.beginDecision(id)!;
    expect(retry.seq).not.toBe(first.seq);
    game.applyDecision(id, retry.seq, answer("stop"));
    expect(game.get(id)!.decision?.outcome.kind).toBe("answered");
  });

  it("asks again for a passed object that is dragged back into the lane ahead", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 20, "ignore");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);

    move(game, id, "own_lane", 40);
    expect(game.get(id)!.phase.kind).toBe("deciding");
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, answer("stop"));
    run(game, 10);
    expect(game.speedMs).toBe(0);
  });

  it("starts over for a passed stop sign moved ahead within the same zone", () => {
    const game = new Game();
    const id = addDecided(game, "sidewalk", 20, "stop_sign");
    while (game.get(id)!.phase.kind !== "passed") game.update(1 / 120);
    expect(game.get(id)!.decision!.released).toBe(true);
    move(game, id, "sidewalk", 40);
    expect(game.get(id)!.phase.kind).toBe("deciding");
    const t = game.beginDecision(id)!;
    game.applyDecision(id, t.seq, answer("stop_sign"));
    expect(game.get(id)!.decision).toMatchObject({ resolved: { behavior: { kind: "stop_sign" } }, released: false });
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
