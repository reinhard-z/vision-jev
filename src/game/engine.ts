import type { DecideResponse, DistanceBand, Zone } from "../../shared/types";
import { failedBehavior, resolveBehavior } from "./behaviors";
import {
  ACCEL,
  CANVAS_WIDTH,
  CAR_FRONT_FROM_BOTTOM_PX,
  CAR_LENGTH_M,
  DEFAULT_TARGET_KMH,
  MAX_DECEL,
  MAX_TARGET_KMH,
  MIN_DROP_AHEAD_M,
  MIN_TARGET_KMH,
  OBJECT_HALF_LENGTH_M,
  OBJECT_SIZE_PX,
  PX_PER_M,
  REMOVE_BUTTON_R,
  ROAD_LEFT,
  ROAD_RIGHT,
  SLOW_DOWN_FACTOR,
  STOP_GAP_M,
  STOP_SIGN_WAIT_S,
} from "./constants";
import { Emitter } from "./emitter";
import { distanceBand, kmhToMs, maxSpeedToStopWithin, msToKmh } from "./physics";
import type { Decision, FailedStage, GameObject, ObjectSnapshot } from "./types";

export interface GameEvents extends Record<string, unknown> {
  /** An object was added or its status changed. Upsert by id. */
  object: ObjectSnapshot;
  /** An object needs a (new) decision, e.g. after being moved to another zone. */
  needsDecision: { id: string };
  /** The car reached an object too late. `null` when cleared. */
  tooLate: { id: string; reason: string } | null;
  /** Base target speed changed (speed limit sign or user). */
  targetSpeed: number;
}

export interface DecisionTicket {
  seq: number;
  caption: string;
  zone: Zone;
  distance: DistanceBand;
  speedKmh: number;
}

let nextId = 1;

/**
 * Game state and simulation. Plain class, no React. The render loop reads
 * from it every frame; React only hears about status changes via `events`.
 */
export class Game {
  readonly events = new Emitter<GameEvents>();

  carS = 0; // position of the car's front bumper, metres
  speedMs = kmhToMs(DEFAULT_TARGET_KMH);
  baseTargetKmh = DEFAULT_TARGET_KMH;
  time = 0; // simulation seconds
  viewHeight = 700; // CSS px, set by the canvas
  objects: GameObject[] = [];
  /** One-line summary of what the car is doing, for the HUD. */
  hudStatus: string | null = null;
  /** Pointer position while a file or sample is dragged over the canvas. */
  dropHint: { x: number; y: number } | null = null;

  private addedAt = new Map<string, number>();
  private dragPos = new Map<string, { x: number; y: number }>();

  // --- coordinates ---------------------------------------------------------

  get carFrontY(): number {
    return this.viewHeight - CAR_FRONT_FROM_BOTTOM_PX;
  }

  sToScreenY(s: number): number {
    return this.carFrontY - (s - this.carS) * PX_PER_M;
  }

  screenYToS(y: number): number {
    return this.carS + (this.carFrontY - y) / PX_PER_M;
  }

  setViewHeight(h: number): void {
    this.viewHeight = h;
  }

  setDropHint(hint: { x: number; y: number } | null): void {
    this.dropHint = hint;
  }

  zoneAt(x: number): Zone {
    return x >= ROAD_LEFT && x <= ROAD_RIGHT ? "road" : "sidewalk";
  }

  /** Metres from the car's front to the object's near edge. */
  distanceAhead(obj: GameObject): number {
    return obj.s - OBJECT_HALF_LENGTH_M - this.carS;
  }

  private clampDrop(x: number, y: number): { x: number; s: number } {
    const half = OBJECT_SIZE_PX / 2;
    const minS = this.carS + MIN_DROP_AHEAD_M + OBJECT_HALF_LENGTH_M;
    const maxS = this.screenYToS(half);
    return {
      x: Math.min(CANVAS_WIDTH - half, Math.max(half, x)),
      s: Math.min(maxS, Math.max(minS, this.screenYToS(y))),
    };
  }

  // --- object lifecycle ----------------------------------------------------

  addObject(image: HTMLImageElement, imageUrl: string, x: number, y: number): string {
    const id = `obj-${nextId++}`;
    const pos = this.clampDrop(x, y);
    const obj: GameObject = {
      id,
      image,
      imageUrl,
      zone: this.zoneAt(pos.x),
      x: pos.x,
      s: pos.s,
      phase: { kind: "perceiving" },
      requestSeq: 0,
      dragging: false,
    };
    this.objects.push(obj);
    this.addedAt.set(id, Date.now());
    this.emitObject(obj);
    return id;
  }

  get(id: string): GameObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  setCaption(id: string, caption: string, visionMs: number): void {
    const obj = this.get(id);
    if (!obj) return;
    obj.caption = caption;
    obj.visionMs = visionMs;
    if (obj.phase.kind === "perceiving") obj.phase = { kind: "deciding" };
    this.emitObject(obj);
  }

  /** The vision model couldn't caption the image: be cautious on the road. */
  failPerception(id: string): void {
    const obj = this.get(id);
    if (!obj || obj.caption !== undefined) return;
    this.setDecision(obj, failedDecision(obj, "perception"));
  }

  /** Snapshot the inputs for a decision request. Distance is measured now. */
  beginDecision(id: string): DecisionTicket | null {
    const obj = this.get(id);
    if (!obj || obj.caption === undefined) return null;
    obj.distanceBand = distanceBand(this.distanceAhead(obj), this.speedMs);
    this.emitObject(obj);
    return {
      seq: obj.requestSeq,
      caption: obj.caption,
      zone: obj.zone,
      distance: obj.distanceBand,
      speedKmh: Math.round(msToKmh(this.speedMs)),
    };
  }

  applyDecision(id: string, seq: number, response: DecideResponse, roundTripMs?: number): void {
    const obj = this.get(id);
    if (!obj || seq !== obj.requestSeq) return; // stale
    this.setDecision(obj, {
      resolved: resolveBehavior(response, obj.zone),
      outcome: { kind: "answered", response, roundTripMs },
    });
  }

  /** No decision could be had (network or server error): be cautious on the road. */
  failDecision(id: string, seq: number): void {
    const obj = this.get(id);
    if (!obj || seq !== obj.requestSeq) return; // stale
    this.setDecision(obj, failedDecision(obj, "decision"));
  }

  /**
   * Record a decision. It drives the car only while the object is ahead and
   * in time; a decision for a "too late" or passed object is still shown.
   */
  private setDecision(obj: GameObject, d: Pick<Decision, "resolved" | "outcome">): void {
    obj.decision = { ...d, released: false, speedLimitApplied: false };
    if (obj.phase.kind === "perceiving" || obj.phase.kind === "deciding") obj.phase = { kind: "decided" };

    const kind = d.resolved.behavior.kind;
    if (kind === "green_light" && obj.phase.kind === "decided") this.releaseLights();
    if (kind === "speed_limit" && obj.phase.kind === "passed") this.applySpeedLimit(obj);
    this.emitObject(obj);
  }

  removeObject(id: string): void {
    const obj = this.get(id);
    if (!obj) return;
    const wasTooLate = obj.phase.kind === "too_late";
    obj.phase = { kind: "removed" };
    obj.requestSeq++;
    this.objects = this.objects.filter((o) => o !== obj);
    this.dragPos.delete(id);
    this.emitObject(obj);
    this.addedAt.delete(id);
    if (wasTooLate) this.emitTooLate();
  }

  private releaseLights(): void {
    for (const o of this.objects) {
      const d = o.decision;
      if (d?.resolved.behavior.kind === "red_light" && !d.released && o.phase.kind === "decided") {
        d.released = true;
        this.emitObject(o);
      }
    }
  }

  private applySpeedLimit(obj: GameObject): void {
    const d = obj.decision;
    if (d?.resolved.behavior.kind !== "speed_limit" || d.speedLimitApplied) return;
    d.speedLimitApplied = true;
    this.setBaseTarget(d.resolved.behavior.kmh);
    this.emitObject(obj);
  }

  setBaseTarget(kmh: number): void {
    const clamped = Math.min(MAX_TARGET_KMH, Math.max(MIN_TARGET_KMH, Math.round(kmh)));
    if (clamped === this.baseTargetKmh) return;
    this.baseTargetKmh = clamped;
    this.events.emit("targetSpeed", clamped);
  }

  // --- dragging objects on the canvas -------------------------------------

  /** Centre of an object's × button, kept inside the canvas. */
  removeButtonCenter(obj: GameObject): { x: number; y: number } {
    const half = OBJECT_SIZE_PX / 2;
    const r = REMOVE_BUTTON_R;
    return {
      x: Math.min(CANVAS_WIDTH - r - 1, obj.x + half),
      y: Math.max(r + 1, this.sToScreenY(obj.s) - half),
    };
  }

  /** The object whose × button is under (x, y), if any. */
  hitTestRemove(x: number, y: number): string | null {
    const r = REMOVE_BUTTON_R + 2; // a little slack for the pointer
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!;
      if (o.dragging) continue;
      const c = this.removeButtonCenter(o);
      if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r * r) return o.id;
    }
    return null;
  }

  hitTest(x: number, y: number): string | null {
    const half = OBJECT_SIZE_PX / 2;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!;
      if (Math.abs(x - o.x) <= half && Math.abs(y - this.sToScreenY(o.s)) <= half) return o.id;
    }
    return null;
  }

  startDrag(id: string, x: number, y: number): void {
    const obj = this.get(id);
    if (!obj) return;
    obj.dragging = true;
    this.dragPos.set(id, { x, y });
  }

  dragTo(id: string, x: number, y: number): void {
    if (this.dragPos.has(id)) this.dragPos.set(id, { x, y });
  }

  /** Finish a drag. Dropping outside the canvas removes the object. */
  endDrag(id: string, x: number, y: number, insideCanvas: boolean): void {
    const obj = this.get(id);
    this.dragPos.delete(id);
    if (!obj) return;
    obj.dragging = false;
    if (!insideCanvas) {
      this.removeObject(id);
      return;
    }
    const pos = this.clampDrop(x, y);
    const newZone = this.zoneAt(pos.x);
    const { phase } = obj;
    obj.x = pos.x;
    obj.s = pos.s;
    // Within a zone an active decision still holds. A passed or too-late
    // object is back ahead of the car (drops are clamped ahead), so it
    // needs a fresh decision like one that changed zones.
    if (newZone === obj.zone && phase.kind !== "passed" && phase.kind !== "too_late") return;

    const visionFailed = obj.decision?.outcome.kind === "failed" && obj.decision.outcome.stage === "perception";
    obj.zone = newZone;
    obj.requestSeq++;
    obj.decision = undefined;
    obj.distanceBand = undefined;
    if (obj.caption !== undefined) {
      obj.phase = { kind: "deciding" };
      this.emitObject(obj);
      this.events.emit("needsDecision", { id });
    } else if (visionFailed) {
      obj.phase = { kind: "deciding" };
      this.setDecision(obj, failedDecision(obj, "perception"));
    } else {
      obj.phase = { kind: "perceiving" }; // the caption is still on its way
      this.emitObject(obj);
    }
    if (phase.kind === "too_late") this.emitTooLate();
  }

  // --- simulation ----------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    const baseMs = kmhToMs(this.baseTargetKmh);
    let desired = baseMs;
    let status: string | null = null;
    let tooLate = false;

    for (const obj of [...this.objects]) {
      const drag = this.dragPos.get(obj.id);
      if (drag) {
        obj.x = Math.min(CANVAS_WIDTH, Math.max(0, drag.x));
        obj.s = this.screenYToS(drag.y);
        continue;
      }

      const ahead = this.distanceAhead(obj);
      const toStopLine = ahead - STOP_GAP_M;
      const d = obj.phase.kind === "decided" ? obj.decision : undefined;
      const b = d?.resolved.behavior;
      const blocking =
        d !== undefined &&
        (d.resolved.behavior.kind === "stop" ||
          ((d.resolved.behavior.kind === "red_light" || d.resolved.behavior.kind === "stop_sign") && !d.released));

      // Reaching a road object before deciding, or too late to stop for it.
      if (obj.zone === "road" && ahead <= 0) {
        if (obj.phase.kind === "perceiving" || obj.phase.kind === "deciding") {
          this.markTooLate(obj, "The car reached it before a decision arrived.");
        } else if (blocking) {
          this.markTooLate(obj, "The decision came too late to stop in time.");
        }
      }

      if (obj.phase.kind === "too_late") {
        tooLate = true;
        continue;
      }

      // A sidewalk object the car has already passed the stop line for
      // doesn't block the lane, so it no longer constrains speed.
      const pastSidewalkLine = obj.zone === "sidewalk" && toStopLine < -0.5;

      if (d && b && !pastSidewalkLine) {
        switch (b.kind) {
          case "slow_down":
            desired = Math.min(desired, baseMs * SLOW_DOWN_FACTOR);
            status ??= "Slowing down";
            break;
          case "stop":
            desired = Math.min(desired, this.stopProfile(toStopLine));
            status ??= "Stopping for an object";
            break;
          case "red_light":
            if (!d.released) {
              desired = Math.min(desired, this.stopProfile(toStopLine));
              status ??= `Waiting at ${b.light} light for green`;
            }
            break;
          case "stop_sign":
            if (!d.released) {
              desired = Math.min(desired, this.stopProfile(toStopLine));
              if (this.speedMs < 0.1 && toStopLine < 1) {
                d.waitStartedAt ??= this.time;
                const waited = this.time - d.waitStartedAt;
                status ??= `Waiting at stop sign (${Math.max(0, STOP_SIGN_WAIT_S - waited).toFixed(1)} s)`;
                if (waited >= STOP_SIGN_WAIT_S) {
                  d.released = true;
                  this.emitObject(obj);
                }
              } else {
                status ??= "Approaching stop sign";
              }
            }
            break;
          case "speed_limit":
            if (ahead <= 0) this.applySpeedLimit(obj);
            break;
          case "continue":
          case "green_light":
            break;
        }
      }

      // Passed once the object is fully behind the car's rear.
      if (obj.phase.kind !== "passed" && obj.s + OBJECT_HALF_LENGTH_M < this.carS - CAR_LENGTH_M) {
        obj.phase = { kind: "passed" };
        this.applySpeedLimit(obj);
        this.emitObject(obj);
      }

      // Drop objects once they have scrolled off the bottom.
      if (obj.phase.kind === "passed" && this.sToScreenY(obj.s) > this.viewHeight + OBJECT_SIZE_PX) {
        this.objects = this.objects.filter((o) => o !== obj);
        this.addedAt.delete(obj.id);
      }
    }

    if (tooLate) {
      this.speedMs = 0;
      this.hudStatus = "Reacted too late";
      return;
    }

    if (this.speedMs < desired) this.speedMs = Math.min(desired, this.speedMs + ACCEL * dt);
    else this.speedMs = Math.max(desired, this.speedMs - MAX_DECEL * dt);
    this.carS += this.speedMs * dt;
    this.hudStatus = status;
  }

  /** Speed that lets the car stop comfortably at the stop line. */
  private stopProfile(toStopLine: number): number {
    return toStopLine < 0.05 ? 0 : maxSpeedToStopWithin(toStopLine);
  }

  private markTooLate(obj: GameObject, reason: string): void {
    obj.phase = { kind: "too_late", reason };
    this.speedMs = 0;
    this.emitObject(obj);
    this.emitTooLate();
  }

  private emitTooLate(): void {
    for (const o of this.objects) {
      if (o.phase.kind === "too_late") return this.events.emit("tooLate", { id: o.id, reason: o.phase.reason });
    }
    this.events.emit("tooLate", null);
  }

  private emitObject(obj: GameObject): void {
    this.events.emit("object", {
      id: obj.id,
      imageUrl: obj.imageUrl,
      zone: obj.zone,
      phase: obj.phase,
      caption: obj.caption,
      visionMs: obj.visionMs,
      distanceBand: obj.distanceBand,
      // Decisions are mutated in place (released, wait timer); snapshot a copy.
      decision: obj.decision && { ...obj.decision },
      addedAt: this.addedAt.get(obj.id) ?? 0,
    });
  }
}

function failedDecision(obj: GameObject, stage: FailedStage): Pick<Decision, "resolved" | "outcome"> {
  return { resolved: failedBehavior(obj.zone, stage), outcome: { kind: "failed", stage } };
}
