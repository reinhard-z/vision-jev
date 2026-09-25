import { CAPTION_MAX_LENGTH } from "../../shared/types";

export interface Perception {
  caption: string;
  visionMs: number;
}

/**
 * Caption an image. STUB: returns a placeholder after a fake delay until the
 * vision worker lands.
 */
export async function perceive(): Promise<Perception> {
  const visionMs = Math.round(200 + Math.random() * 400);
  await new Promise((resolve) => setTimeout(resolve, visionMs));
  const caption = "an unidentified object (no vision model yet)";
  return { caption: caption.slice(0, CAPTION_MAX_LENGTH), visionMs };
}
