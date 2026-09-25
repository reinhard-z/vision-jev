import { useRef, type ChangeEvent } from "react";
import type { Pipeline } from "../pipeline";
import { CAR_X } from "../game/render";
import { SAMPLES, SAMPLE_DRAG_TYPE } from "../samples";

// Where a click (instead of a drag) puts a sample: on the road, far ahead.
const CLICK_DROP = { x: CAR_X, y: 40 };

export function SampleTray({ pipeline }: { pipeline: Pipeline }) {
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void pipeline.spawn(URL.createObjectURL(file), CLICK_DROP.x, CLICK_DROP.y);
    e.target.value = "";
  };

  return (
    <aside className="tray">
      <h2>Samples</h2>
      <p className="hint">Drag onto the road or sidewalk, or click to drop on the road.</p>
      <div className="tray-grid">
        {SAMPLES.map((s) => (
          <button
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
            onClick={() => void pipeline.spawn(s.url, CLICK_DROP.x, CLICK_DROP.y, s.caption)}
          >
            <img src={s.url} alt="" draggable={false} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <button className="upload" onClick={() => fileInput.current?.click()}>
        Add your own image…
      </button>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFile} />
      <p className="hint">You can also drop image files straight onto the road. Drag an object off the canvas or double-click it to remove it.</p>
      <p className="hint privacy">Images never leave your device. Only the caption is sent.</p>
    </aside>
  );
}
