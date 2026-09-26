// Sample photos in public/samples/ (sources and licenses in CREDITS.md).
// Every image, sample or not, is captioned by the vision model.

export interface Sample {
  id: string;
  label: string;
  url: string;
  /** Added by the user this session; can be removed from the tray. */
  own?: boolean;
}

const photo = (id: string, label: string): Sample => ({ id, label, url: `/samples/${id}.jpg` });

export const SAMPLES: Sample[] = [
  photo("child", "Child"),
  photo("adult", "Adult"),
  photo("teddy", "Teddy"),
  photo("dog", "Dog"),
  photo("cat", "Cat"),
  photo("bicycle", "Bicycle"),
  photo("car", "Car"),
  photo("stop", "Stop sign"),
  photo("red", "Red light"),
  photo("amber", "Amber light"),
  photo("green", "Green light"),
  photo("limit30", "30 sign"),
  photo("limit80", "80 sign"),
  photo("box", "Box"),
  photo("bag", "Bag"),
  photo("leaves", "Leaves"),
];

// Drag payload from the tray to the road: just the image.
const SAMPLE_DRAG_TYPE = "application/x-jev-sample";

interface DragPayload {
  url: string;
}

export function setSampleDragData(dt: DataTransfer, sample: Sample): void {
  const payload: DragPayload = { url: sample.url };
  dt.setData(SAMPLE_DRAG_TYPE, JSON.stringify(payload));
}

export function getSampleDragData(dt: DataTransfer): DragPayload | null {
  const raw = dt.getData(SAMPLE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as DragPayload;
    return typeof p.url === "string" ? p : null;
  } catch {
    return null;
  }
}

let nextOwnId = 1;

/**
 * Turn image files into tray entries. Object URLs live for the session and
 * are never revoked: thought cards keep showing an image after it leaves the
 * tray or the road, and a handful of local files is cheap to keep.
 */
export function samplesFromFiles(files: Iterable<File>): Sample[] {
  return [...files]
    .filter((f) => f.type.startsWith("image/"))
    .map((f) => ({
      id: `own-${nextOwnId++}`,
      label: f.name.replace(/\.[^.]+$/, ""),
      url: URL.createObjectURL(f),
      own: true,
    }));
}
