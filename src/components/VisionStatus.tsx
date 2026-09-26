import { useStore } from "zustand";
import { visionStore } from "../perception/perceive";

const mb = (bytes: number) => (bytes / 1e6).toFixed(0);

/** First-load progress for the vision model, then which backend it runs on. */
export function VisionStatus() {
  const status = useStore(visionStore);

  if (status.state === "error") {
    return (
      <div className="vision-status vision-error" role="alert">
        Vision model failed to load: {status.message}
      </div>
    );
  }

  if (status.state === "ready") {
    return (
      <div className="vision-status" title={`${status.model} · loaded in ${(status.loadMs / 1000).toFixed(1)} s`}>
        Vision model ready · {status.backend === "webgpu" ? "WebGPU" : "Wasm (CPU, slower)"}
      </div>
    );
  }

  const { loadedBytes, totalBytes } = status;
  const pct = totalBytes > 0 ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0;
  return (
    <div className="vision-status" role="status">
      <div>
        Loading vision model…{" "}
        {totalBytes > 0 && (
          <span className="vision-bytes">
            {mb(loadedBytes)} / {mb(totalBytes)} MB
          </span>
        )}
      </div>
      <div className="vision-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="vision-note">First visit only; the model is cached in your browser.</div>
    </div>
  );
}
