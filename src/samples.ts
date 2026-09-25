// Stage 1 placeholder samples: generated SVG tiles, each with the caption a
// vision model might produce. Stage 2 replaces these with photos in
// public/samples/ and real captions.

export interface Sample {
  id: string;
  label: string;
  caption: string;
  url: string;
}

const svg = (body: string, bg = "#f4f1ea") =>
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
      `<rect width="128" height="128" rx="14" fill="${bg}"/>${body}</svg>`,
  );

const emoji = (char: string) =>
  svg(`<text x="64" y="70" font-size="84" text-anchor="middle" dominant-baseline="middle">${char}</text>`);

const trafficLight = (lit: "red" | "amber" | "green") => {
  const lamp = (color: string, on: boolean, cy: number) =>
    `<circle cx="64" cy="${cy}" r="14" fill="${on ? color : "#3a3a3a"}"${on ? ` stroke="#fff" stroke-opacity=".5" stroke-width="3"` : ""}/>`;
  return svg(
    `<rect x="60" y="100" width="8" height="28" fill="#555"/>` +
      `<rect x="42" y="8" width="44" height="96" rx="10" fill="#1d1d1f"/>` +
      lamp("#ff3b30", lit === "red", 28) +
      lamp("#ffb000", lit === "amber", 56) +
      lamp("#34c759", lit === "green", 84),
  );
};

const stopSign = svg(
  `<polygon points="44,10 84,10 114,40 114,80 84,110 44,110 14,80 14,40" fill="#d0021b" stroke="#fff" stroke-width="5"/>` +
    `<text x="64" y="62" font-family="Arial, sans-serif" font-weight="700" font-size="30" fill="#fff" text-anchor="middle" dominant-baseline="middle">STOP</text>`,
);

const speedSign = (kmh: number) =>
  svg(
    `<circle cx="64" cy="64" r="52" fill="#fff" stroke="#d0021b" stroke-width="12"/>` +
      `<text x="64" y="66" font-family="Arial, sans-serif" font-weight="700" font-size="${kmh >= 100 ? 36 : 44}" fill="#111" text-anchor="middle" dominant-baseline="middle">${kmh}</text>`,
  );

export const SAMPLES: Sample[] = [
  { id: "child", label: "Child", caption: "a small child in a red jacket standing", url: emoji("🧒") },
  { id: "adult", label: "Adult", caption: "an adult man walking across the street", url: emoji("🚶") },
  { id: "teddy", label: "Teddy", caption: "a teddy bear lying on the ground", url: emoji("🧸") },
  { id: "dog", label: "Dog", caption: "a brown dog standing on the pavement", url: emoji("🐕") },
  { id: "cat", label: "Cat", caption: "a grey cat sitting", url: emoji("🐈") },
  { id: "bicycle", label: "Bicycle", caption: "a bicycle", url: emoji("🚲") },
  { id: "car", label: "Car", caption: "a red car parked", url: emoji("🚗") },
  { id: "stop", label: "Stop sign", caption: "a red octagonal stop sign", url: stopSign },
  { id: "red", label: "Red light", caption: "a traffic light with the red lamp lit", url: trafficLight("red") },
  { id: "amber", label: "Amber light", caption: "a traffic light with the amber lamp lit", url: trafficLight("amber") },
  { id: "green", label: "Green light", caption: "a traffic light with the green lamp lit", url: trafficLight("green") },
  { id: "limit30", label: "30 sign", caption: "a round speed limit sign showing 30", url: speedSign(30) },
  { id: "limit80", label: "80 sign", caption: "a round speed limit sign showing 80", url: speedSign(80) },
  { id: "box", label: "Box", caption: "a cardboard box", url: emoji("📦") },
  { id: "bag", label: "Bag", caption: "a plastic shopping bag", url: emoji("🛍️") },
  { id: "leaves", label: "Leaves", caption: "a pile of dry autumn leaves", url: emoji("🍂") },
];

export const SAMPLE_DRAG_TYPE = "application/x-jev-sample";

export function findSample(id: string): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
