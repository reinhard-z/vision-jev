const FIXED_STEP = 1 / 120;
const MAX_FRAME = 0.1; // avoid a huge catch-up after a background tab

/** requestAnimationFrame loop with a fixed simulation step. Returns stop(). */
export function runLoop(step: (dt: number) => void, draw: () => void): () => void {
  let raf = 0;
  let last = performance.now();
  let acc = 0;

  const frame = (now: number) => {
    acc += Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    while (acc >= FIXED_STEP) {
      step(FIXED_STEP);
      acc -= FIXED_STEP;
    }
    draw();
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
