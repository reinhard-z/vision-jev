/// <reference lib="webworker" />
// Runs the vision model off the main thread so the game loop never waits on it.
import { RawImage } from "@huggingface/transformers";
import { loadCaptioner, type Captioner } from "./model";
import type { Backend, FromWorker, ToWorker } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const send = (msg: FromWorker) => self.postMessage(msg);

let captioner: Promise<Captioner> | null = null;
// Captions run strictly one at a time, in arrival order.
let queue: Promise<unknown> = Promise.resolve();

async function pickBackend(): Promise<Backend> {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) return "webgpu";
  } catch {
    // fall through to wasm
  }
  return "wasm";
}

async function load(): Promise<Captioner> {
  const t0 = performance.now();
  const files = new Map<string, { loaded: number; total: number }>();
  const onProgress = (file: string, loaded: number, total: number) => {
    files.set(file, { loaded, total });
    let loadedBytes = 0;
    let totalBytes = 0;
    for (const f of files.values()) {
      loadedBytes += f.loaded;
      totalBytes += f.total;
    }
    send({ type: "progress", loadedBytes, totalBytes });
  };

  let backend = await pickBackend();
  let c: Captioner;
  try {
    c = await loadCaptioner(backend, onProgress);
  } catch (err) {
    if (backend !== "webgpu") throw err;
    // WebGPU adapter exists but the model can't run on it (e.g. missing fp16).
    console.warn("WebGPU load failed, falling back to Wasm", err);
    backend = "wasm";
    files.clear();
    c = await loadCaptioner(backend, onProgress);
  }
  send({ type: "ready", backend, loadMs: Math.round(performance.now() - t0) });
  return c;
}

function getCaptioner(): Promise<Captioner> {
  captioner ??= load().catch((err: unknown) => {
    send({ type: "loadError", message: err instanceof Error ? err.message : String(err) });
    throw err;
  });
  return captioner;
}

function toRawImage(bitmap: ImageBitmap): RawImage {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return new RawImage(data, width, height, 4).rgb();
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "load") {
    void getCaptioner().catch(() => {});
    return;
  }
  const { id, image } = msg;
  queue = queue.then(async () => {
    try {
      const caption = await getCaptioner();
      const t = performance.now();
      const text = await caption(toRawImage(image));
      send({ type: "caption", id, text, ms: performance.now() - t });
    } catch (err) {
      send({ type: "captionError", id, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
