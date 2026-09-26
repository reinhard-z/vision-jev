import { useRef, useState, type DragEvent } from "react";
import { useStore } from "zustand";
import { visionStore } from "../perception/perceive";
import type { Pipeline } from "../pipeline";
import { SAMPLES, samplesFromFiles, setSampleDragData, type Sample } from "../samples";
import { CreditsDialog } from "./CreditsDialog";
import { VisionStatus } from "./VisionStatus";

/**
 * Sample images plus the user's own. Placing is drag-only: where you drop
 * decides the lane or the sidewalk. Own images are added to the tray first.
 * Captioning starts as soon as a drag begins.
 */
export function SampleTray({ pipeline }: { pipeline: Pipeline }) {
  const [own, setOwn] = useState<Sample[]>([]);
  const [fileOver, setFileOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Nothing can be captioned until the model is loaded, so the tiles can't be dragged yet.
  const loading = useStore(visionStore, (s) => s.state === "loading");

  const addFiles = (files: Iterable<File>) => {
    const added = samplesFromFiles(files);
    if (added.length) setOwn((prev) => [...added, ...prev]);
  };

  // Files dropped on the tray go into the library. Tray tiles dragged back
  // onto the tray carry no files, so they're ignored.
  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <aside
      className={`tray ${fileOver ? "tray-file-over" : ""}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setFileOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileOver(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setFileOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <h2>Samples</h2>
      <VisionStatus />
      <button className="upload" onClick={() => fileInput.current?.click()}>
        Add your own images…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="hint">Or drop image files here.</p>
      <p className="hint">Drag into a lane or onto the sidewalk.</p>
      <div className={`tray-grid ${loading ? "tray-grid-loading" : ""}`} aria-disabled={loading}>
        {[...own, ...SAMPLES].map((s) => (
          <div
            key={s.id}
            className="sample"
            draggable={!loading}
            title={loading ? `${s.label} (waiting for the vision model)` : s.label}
            onDragStart={(e) => {
              setSampleDragData(e.dataTransfer, s);
              pipeline.prefetch(s.url);
              e.dataTransfer.effectAllowed = "copy";
              // Drag preview: just the picture, centred on the cursor.
              const img = e.currentTarget.querySelector("img");
              if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
            }}
          >
            <img src={s.url} alt={s.label} draggable={false} />
            {s.own && (
              <button
                className="sample-remove"
                aria-label={`Remove ${s.label}`}
                title="Remove from tray"
                onClick={() => setOwn((prev) => prev.filter((o) => o.id !== s.id))}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="tray-links">
        <a className="link-button" href="https://github.com/reinhard-z/vision-jev" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
        <a className="link-button" href="https://docs.typesafe.ai" target="_blank" rel="noreferrer">
          About Jev
        </a>
        <CreditsDialog />
      </div>
    </aside>
  );
}
