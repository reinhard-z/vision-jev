import { useRef, useState, type DragEvent } from "react";
import { SAMPLES, samplesFromFiles, setSampleDragData, type Sample } from "../samples";
import { VisionStatus } from "./VisionStatus";

/**
 * Sample images plus the user's own. Placing is drag-only: where you drop
 * decides road vs sidewalk. Own images are added to the tray first.
 */
export function SampleTray() {
  const [own, setOwn] = useState<Sample[]>([]);
  const [fileOver, setFileOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
      <p className="hint privacy">Images never leave your device.</p>
      <p className="hint">Drag onto the road or the sidewalk.</p>
      <div className="tray-grid">
        {[...own, ...SAMPLES].map((s) => (
          <div
            key={s.id}
            className="sample"
            draggable
            title={s.label}
            onDragStart={(e) => {
              setSampleDragData(e.dataTransfer, s);
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
    </aside>
  );
}
