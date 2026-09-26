import {
  CANVAS_WIDTH,
  GRASS_W,
  OBJECT_HALF_LENGTH_M,
  OBJECT_SIZE_PX,
  PX_PER_M,
  REMOVE_BUTTON_R,
  ROAD_LEFT,
  ROAD_MID,
  ROAD_RIGHT,
  ROAD_W,
  SIDEWALK_W,
  STOP_GAP_M,
  CAR_LENGTH_M,
} from "./constants";
import { activeDecision, type Game } from "./engine";
import { msToKmh } from "./physics";
import { ZONE_LABEL, type GameObject } from "./types";

export const CAR_X = ROAD_LEFT + (ROAD_W * 3) / 4; // centre of the right lane
const CAR_W = 44;

const COLORS = {
  grass: "#6f9e4f",
  sidewalk: "#c9c4b8",
  seam: "#b3ad9f",
  curb: "#8f8a7e",
  road: "#3b3e44",
  line: "#f1f1ee",
  car: "#2f6fdb",
  go: "#2e9d57",
  slow: "#e0a019",
  stop: "#d93d3d",
  info: "#4a5568",
};

export function render(ctx: CanvasRenderingContext2D, game: Game): void {
  const h = game.viewHeight;
  const scroll = game.carS * PX_PER_M;
  ctx.clearRect(0, 0, CANVAS_WIDTH, h);

  drawGround(ctx, h, scroll);
  drawStopLines(ctx, game);
  drawDropHint(ctx, game);

  for (const obj of game.objects) drawObject(ctx, game, obj);

  drawCar(ctx, game);
  drawHud(ctx, game);
}

function drawGround(ctx: CanvasRenderingContext2D, h: number, scroll: number): void {
  ctx.fillStyle = COLORS.grass;
  ctx.fillRect(0, 0, CANVAS_WIDTH, h);

  ctx.fillStyle = COLORS.sidewalk;
  ctx.fillRect(GRASS_W, 0, SIDEWALK_W, h);
  ctx.fillRect(ROAD_RIGHT, 0, SIDEWALK_W, h);

  // Paving seams scroll with the car.
  const tile = 40;
  ctx.strokeStyle = COLORS.seam;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = (scroll % tile) - tile; y < h; y += tile) {
    ctx.moveTo(GRASS_W, y);
    ctx.lineTo(GRASS_W + SIDEWALK_W, y);
    ctx.moveTo(ROAD_RIGHT, y);
    ctx.lineTo(ROAD_RIGHT + SIDEWALK_W, y);
  }
  ctx.stroke();

  ctx.fillStyle = COLORS.road;
  ctx.fillRect(ROAD_LEFT, 0, ROAD_W, h);
  ctx.fillStyle = COLORS.curb;
  ctx.fillRect(ROAD_LEFT - 3, 0, 3, h);
  ctx.fillRect(ROAD_RIGHT, 0, 3, h);

  // Edge lines and a dashed centre line.
  ctx.fillStyle = COLORS.line;
  ctx.fillRect(ROAD_LEFT + 6, 0, 2, h);
  ctx.fillRect(ROAD_RIGHT - 8, 0, 2, h);
  const dash = 48;
  const cx = ROAD_MID - 1.5;
  for (let y = (scroll % dash) - dash; y < h; y += dash) ctx.fillRect(cx, y, 3, dash / 2);
}

function drawDropHint(ctx: CanvasRenderingContext2D, game: Game): void {
  if (!game.dropHint) return;
  const { x, y } = game.dropHint;
  const zone = game.zoneAt(x);
  ctx.save();
  ctx.fillStyle =
    zone === "near_sidewalk" || zone === "far_sidewalk" ? "rgba(255,230,120,0.22)" : "rgba(255,255,255,0.12)";
  if (zone === "own_lane") ctx.fillRect(ROAD_MID, 0, ROAD_RIGHT - ROAD_MID, game.viewHeight);
  else if (zone === "oncoming_lane") ctx.fillRect(ROAD_LEFT, 0, ROAD_MID - ROAD_LEFT, game.viewHeight);
  else if (zone === "far_sidewalk") ctx.fillRect(0, 0, ROAD_LEFT, game.viewHeight);
  else ctx.fillRect(ROAD_RIGHT, 0, CANVAS_WIDTH - ROAD_RIGHT, game.viewHeight);
  ctx.strokeStyle = "#fff";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  const half = OBJECT_SIZE_PX / 2;
  roundRect(ctx, x - half, y - half, OBJECT_SIZE_PX, OBJECT_SIZE_PX, 6);
  ctx.stroke();
  ctx.restore();
  label(ctx, ZONE_LABEL[zone], x, y - half - 12, "rgba(20,20,30,0.85)");
}

function drawStopLines(ctx: CanvasRenderingContext2D, game: Game): void {
  for (const obj of game.objects) {
    const d = activeDecision(obj);
    if (!d || obj.dragging) continue;
    const b = d.resolved.behavior;
    const holds = b.kind === "stop" || ((b.kind === "stop_sign" || b.kind === "red_light") && !d.released);
    if (!holds) continue;
    // Across the car's lane, where it will stop.
    const y = game.sToScreenY(obj.s - OBJECT_HALF_LENGTH_M - STOP_GAP_M);
    ctx.fillStyle = b.kind === "stop" ? COLORS.stop : COLORS.line;
    ctx.fillRect(ROAD_MID + 4, y - 2, ROAD_RIGHT - ROAD_MID - 12, 4);
  }
}

function drawObject(ctx: CanvasRenderingContext2D, game: Game, obj: GameObject): void {
  const size = OBJECT_SIZE_PX;
  const cx = obj.x;
  const cy = game.sToScreenY(obj.s);
  const x = cx - size / 2;
  const y = cy - size / 2;

  ctx.save();
  if (obj.phase.kind === "passed") ctx.globalAlpha = 0.6;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = obj.dragging ? 14 : 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#fff";
  roundRect(ctx, x - 3, y - 3, size + 6, size + 6, 6);
  ctx.fill();
  ctx.shadowColor = "transparent";
  drawImageContain(ctx, obj.image, x, y, size, size);
  ctx.restore();

  if (obj.phase.kind === "perceiving" || obj.phase.kind === "deciding") {
    const phase = (game.time * 40) % 16;
    ctx.save();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -phase;
    roundRect(ctx, x - 7, y - 7, size + 14, size + 14, 9);
    ctx.stroke();
    ctx.restore();
    const dots = ".".repeat(1 + (Math.floor(game.time * 3) % 3));
    label(ctx, `${obj.phase.kind}${dots}`, cx, y - 16, "rgba(20,20,30,0.85)");
  } else if (obj.phase.kind === "too_late") {
    const on = Math.floor(game.time * 4) % 2 === 0;
    ctx.save();
    ctx.strokeStyle = on ? COLORS.stop : "#fff";
    ctx.lineWidth = 4;
    roundRect(ctx, x - 7, y - 7, size + 14, size + 14, 9);
    ctx.stroke();
    ctx.restore();
    label(ctx, "too late!", cx, y - 16, COLORS.stop);
  } else {
    const badge = badgeFor(obj);
    if (badge) label(ctx, badge.text, cx + size / 2 - 4, y + size + 4, badge.color);
  }

  if (!obj.dragging) drawRemoveButton(ctx, game.removeButtonCenter(obj));
}

function drawRemoveButton(ctx: CanvasRenderingContext2D, c: { x: number; y: number }): void {
  const r = REMOVE_BUTTON_R;
  const arm = r * 0.4;
  ctx.save();
  ctx.fillStyle = "rgba(20,20,30,0.85)";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(c.x - arm, c.y - arm);
  ctx.lineTo(c.x + arm, c.y + arm);
  ctx.moveTo(c.x + arm, c.y - arm);
  ctx.lineTo(c.x - arm, c.y + arm);
  ctx.stroke();
  ctx.restore();
}

function badgeFor(obj: GameObject): { text: string; color: string } | null {
  const d = obj.decision;
  if (!d) return null;
  const b = d.resolved.behavior;
  switch (b.kind) {
    case "continue":
      return { text: "GO", color: COLORS.go };
    case "slow_down":
      return { text: "SLOW", color: COLORS.slow };
    case "stop":
      return { text: "STOP", color: COLORS.stop };
    case "stop_sign":
      return d.released ? { text: "GO", color: COLORS.go } : { text: "STOP", color: COLORS.stop };
    case "red_light":
      return d.released ? { text: "GREEN", color: COLORS.go } : { text: "WAIT", color: COLORS.stop };
    case "green_light":
      return { text: "GO", color: COLORS.go };
    case "speed_limit":
      return { text: `${b.kmh}`, color: COLORS.info };
  }
}

function drawCar(ctx: CanvasRenderingContext2D, game: Game): void {
  const len = CAR_LENGTH_M * PX_PER_M;
  const x = CAR_X - CAR_W / 2;
  const y = game.carFrontY;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = COLORS.car;
  roundRect(ctx, x, y, CAR_W, len, 10);
  ctx.fill();
  ctx.restore();

  // Windscreen, rear window, roof.
  ctx.fillStyle = "#b9d4f5";
  roundRect(ctx, x + 6, y + 14, CAR_W - 12, 14, 4);
  ctx.fill();
  roundRect(ctx, x + 7, y + len - 20, CAR_W - 14, 10, 3);
  ctx.fill();
  ctx.fillStyle = "#2a5fbd";
  roundRect(ctx, x + 6, y + 30, CAR_W - 12, len - 52, 4);
  ctx.fill();

  // Headlights, and brake lights when stopped or braking.
  ctx.fillStyle = "#fff6c7";
  ctx.fillRect(x + 5, y + 1, 9, 4);
  ctx.fillRect(x + CAR_W - 14, y + 1, 9, 4);
  const braking = game.speedMs < 0.5 || game.hudStatus !== null;
  ctx.fillStyle = braking ? "#ff3b3b" : "#8a1f1f";
  ctx.fillRect(x + 5, y + len - 5, 9, 4);
  ctx.fillRect(x + CAR_W - 14, y + len - 5, 9, 4);
}

function drawHud(ctx: CanvasRenderingContext2D, game: Game): void {
  const kmh = Math.round(msToKmh(game.speedMs));
  const lines = [`${kmh} km/h  →  ${game.baseTargetKmh}`];
  if (game.hudStatus) lines.push(game.hudStatus);
  ctx.save();
  ctx.font = "600 13px system-ui, sans-serif";
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
  const h = 10 + lines.length * 18;
  ctx.fillStyle = "rgba(15,17,22,0.78)";
  roundRect(ctx, 8, 8, w, h, 8);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    ctx.font = i === 0 ? "600 13px system-ui, sans-serif" : "12px system-ui, sans-serif";
    ctx.fillText(l, 18, 15 + i * 18);
  });
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, bg: string): void {
  ctx.save();
  ctx.font = "600 11px system-ui, sans-serif";
  const w = ctx.measureText(text).width + 10;
  const x = Math.min(CANVAS_WIDTH - w - 2, Math.max(2, cx - w / 2));
  ctx.fillStyle = bg;
  roundRect(ctx, x, cy - 9, w, 18, 9);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, cy + 0.5);
  ctx.restore();
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!img.complete || img.naturalWidth === 0) return;
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
