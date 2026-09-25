import { CAPTION_MAX_LENGTH } from "../../shared/types";

export interface Perception {
  caption: string;
  visionMs: number;
}

/**
 * Caption an image. STAGE 1 STUB: returns the sample's known caption (or a
 * placeholder for user files) after a fake delay. Stage 2 runs a vision
 * model in a Web Worker instead.
 */
export async function perceive(_imageUrl: string, knownCaption?: string): Promise<Perception> {
  const visionMs = Math.round(200 + Math.random() * 400);
  await new Promise((resolve) => setTimeout(resolve, visionMs));
  const caption = knownCaption ?? "an unidentified object (no vision model yet)";
  return { caption: caption.slice(0, CAPTION_MAX_LENGTH), visionMs };
}
