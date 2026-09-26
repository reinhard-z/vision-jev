import { useEffect, useRef, type DragEvent, type MouseEvent, type PointerEvent } from "react";
import { useStore } from "zustand";
import { CANVAS_WIDTH } from "../game/constants";
import type { Game } from "../game/engine";
import { runLoop } from "../game/loop";
import { render } from "../game/render";
import type { Pipeline } from "../pipeline";
import { getSampleDragData } from "../samples";

// willReadFrequently keeps the canvas on the CPU. A GPU canvas queues
// behind the vision model's WebGPU work and drops frames (100-400 ms
// hitches per caption); on the CPU it stays smooth. See docs/vision-models.md.
// The first getContext() call fixes these attributes, so every call uses them.
const CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = { willReadFrequently: true };

const context2d = (canvas: HTMLCanvasElement) => canvas.getContext("2d", CONTEXT_OPTIONS)!;

interface Props {
  game: Game;
  pipeline: Pipeline;
}

/** The road. Owns the canvas and the game loop; handles drops and drags. */
export function RoadCanvas({ game, pipeline }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragId = useRef<string | null>(null);
  const tooLate = useStore(game.ui, (s) => s.tooLate);

  // Size the canvas to its container (height) and device pixel ratio.
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const h = Math.max(300, wrap.clientHeight);
      canvas.width = Math.round(CANVAS_WIDTH * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${CANVAS_WIDTH}px`;
      canvas.style.height = `${h}px`;
      context2d(canvas).setTransform(dpr, 0, 0, dpr, 0, 0);
      game.setViewHeight(h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [game]);

  useEffect(() => {
    const ctx = context2d(canvasRef.current!);
    return runLoop(
      (dt) => game.update(dt),
      () => render(ctx, game),
    );
  }, [game]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, inside };
  };

  // --- dropping new images -------------------------------------------------

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    game.setDropHint(toCanvas(e));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    game.setDropHint(null);
    const { x, y } = toCanvas(e);
    const sample = getSampleDragData(e.dataTransfer);
    if (sample) {
      void pipeline.spawn(sample.url, x, y);
      return;
    }
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    // Kept for the session, like tray images (see samplesFromFiles).
    if (file) void pipeline.spawn(URL.createObjectURL(file), x, y);
  };

  // --- moving and removing objects already on the road ---------------------

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // primary button, touch or pen only
    const { x, y } = toCanvas(e);
    const removeId = game.hitTestRemove(x, y);
    if (removeId) {
      game.removeObject(removeId);
      e.currentTarget.style.cursor = "default";
      return;
    }
    const id = game.hitTest(x, y);
    if (!id) return;
    dragId.current = id;
    game.startDrag(id, x, y);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.style.cursor = "grabbing";
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvas(e);
    if (dragId.current) game.dragTo(dragId.current, x, y);
    else if (game.hitTestRemove(x, y)) e.currentTarget.style.cursor = "pointer";
    else e.currentTarget.style.cursor = game.hitTest(x, y) ? "grab" : "default";
  };

  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const id = dragId.current;
    if (!id) return;
    dragId.current = null;
    const { x, y, inside } = toCanvas(e);
    game.endDrag(id, x, y, inside);
    e.currentTarget.style.cursor = "default";
  };

  const onDoubleClick = (e: MouseEvent) => {
    const { x, y } = toCanvas(e);
    const id = game.hitTest(x, y);
    if (id) game.removeObject(id);
  };

  return (
    <div className="road" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Top-down road with the car in the right lane. Drop images in its lane, the oncoming lane or on a sidewalk; the Thoughts panel describes what the car decides."
        onDragOver={onDragOver}
        onDragLeave={() => game.setDropHint(null)}
        onDrop={onDrop}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      {tooLate && (
        <div className="too-late" role="alert">
          <strong>Reacted too late</strong>
          <span>{tooLate.reason}</span>
          <button onClick={() => game.removeObject(tooLate.id)}>Remove it and drive on</button>
        </div>
      )}
    </div>
  );
}
