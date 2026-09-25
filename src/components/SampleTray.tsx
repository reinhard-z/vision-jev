import { SAMPLES, SAMPLE_DRAG_TYPE } from "../samples";

/** Sample images. Drag-only: where you drop decides road vs sidewalk. */
export function SampleTray() {
  return (
    <aside className="tray">
      <h2>Samples</h2>
      <p className="hint">Drag onto the road or the sidewalk.</p>
      <div className="tray-grid">
        {SAMPLES.map((s) => (
          <div
            key={s.id}
            className="sample"
            draggable
            title={s.caption}
            onDragStart={(e) => {
              e.dataTransfer.setData(SAMPLE_DRAG_TYPE, s.id);
              e.dataTransfer.effectAllowed = "copy";
              // Drag preview: just the picture, centred on the cursor.
              const img = e.currentTarget.querySelector("img");
              if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
            }}
          >
            <img src={s.url} alt="" draggable={false} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <p className="hint">You can also drop your own image files onto the road or sidewalk. Drag an object off the canvas or double-click it to remove it.</p>
      <p className="hint privacy">Images never leave your device. Only the caption is sent.</p>
    </aside>
  );
}
