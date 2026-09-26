// Messages between the main thread (perceive.ts) and the vision worker.

export type Backend = "webgpu" | "wasm";

export type ToWorker = { type: "load" } | { type: "caption"; id: number; image: ImageBitmap };

export type FromWorker =
  | { type: "progress"; loadedBytes: number; totalBytes: number }
  | { type: "warming" }
  | { type: "ready"; backend: Backend; loadMs: number; model: string }
  | { type: "loadError"; message: string }
  | { type: "caption"; id: number; text: string; ms: number }
  | { type: "captionError"; id: number; message: string };
