import { CAPTION_MAX_LENGTH } from "../../shared/types";
import type { Backend, FromWorker, ToWorker } from "./protocol";

export interface Perception {
  caption: string;
  visionMs: number;
}

/** Model loading state, for the progress bar. */
export type VisionStatus =
  | { state: "loading"; loadedBytes: number; totalBytes: number }
  | { state: "ready"; backend: Backend; loadMs: number }
  | { state: "error"; message: string };

// Images are downscaled before they go to the worker. The models resize to
// well under this anyway; it keeps transfers and decoding cheap for big photos.
const MAX_IMAGE_SIDE = 768;

let worker: Worker | null = null;
let status: VisionStatus = { state: "loading", loadedBytes: 0, totalBytes: 0 };
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: (p: Perception) => void; reject: (e: Error) => void }>();
let nextId = 1;

function setStatus(next: VisionStatus): void {
  status = next;
  for (const l of listeners) l();
}

function post(msg: ToWorker, transfer: Transferable[] = []): void {
  getWorker().postMessage(msg, transfer);
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./vision.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const msg = e.data;
    switch (msg.type) {
      case "progress":
        setStatus({ state: "loading", loadedBytes: msg.loadedBytes, totalBytes: msg.totalBytes });
        break;
      case "ready":
        setStatus({ state: "ready", backend: msg.backend, loadMs: msg.loadMs });
        break;
      case "loadError":
        setStatus({ state: "error", message: msg.message });
        for (const p of pending.values()) p.reject(new Error(msg.message));
        pending.clear();
        break;
      case "caption": {
        const caption = msg.text.trim().slice(0, CAPTION_MAX_LENGTH) || "nothing recognisable";
        pending.get(msg.id)?.resolve({ caption, visionMs: Math.round(msg.ms) });
        pending.delete(msg.id);
        break;
      }
      case "captionError":
        pending.get(msg.id)?.reject(new Error(msg.message));
        pending.delete(msg.id);
        break;
    }
  };
  worker.onerror = (e) => setStatus({ state: "error", message: e.message || "vision worker crashed" });
  return worker;
}

/** Start downloading the model. Safe to call more than once. */
export function loadVision(): void {
  if (!worker) post({ type: "load" });
}

export function getVisionStatus(): VisionStatus {
  return status;
}

export function subscribeVision(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Caption an image in the vision worker. Requests queue up in the worker and
 * run one at a time; ones sent before the model is ready wait for it.
 * `visionMs` is model time only, not time spent waiting in the queue.
 */
export async function perceive(imageUrl: string): Promise<Perception> {
  loadVision();
  const blob = await (await fetch(imageUrl)).blob();
  const image = await downscaledBitmap(blob);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    if (status.state === "error") return reject(new Error(status.message));
    pending.set(id, { resolve, reject });
    post({ type: "caption", id, image }, [image]);
  });
}

async function downscaledBitmap(blob: Blob): Promise<ImageBitmap> {
  const full = await createImageBitmap(blob);
  const { width, height } = full;
  const scale = MAX_IMAGE_SIDE / Math.max(width, height);
  if (scale >= 1) return full;
  full.close();
  return createImageBitmap(blob, {
    resizeWidth: Math.round(width * scale),
    resizeHeight: Math.round(height * scale),
    resizeQuality: "high",
  });
}
