import { decide } from "./api/decide";
import type { Game } from "./game/engine";
import { perceive } from "./perception/perceive";

/**
 * Connects the game to perception and decisions:
 * drop -> caption (vision) -> decision (Jev) -> behavior (game).
 */
export class Pipeline {
  constructor(private game: Game) {}

  /** Re-decide objects the game flags (e.g. moved to another zone). Returns unsubscribe. */
  attach(): () => void {
    return this.game.events.on("needsDecision", ({ id }) => void this.runDecision(id));
  }

  /** Add an image at a canvas position and start perceiving it. */
  async spawn(imageUrl: string, x: number, y: number, knownCaption?: string): Promise<void> {
    const image = await loadImage(imageUrl);
    const id = this.game.addObject(image, imageUrl, x, y);
    try {
      const { caption, visionMs } = await perceive(imageUrl, knownCaption);
      this.game.setCaption(id, caption, visionMs);
      await this.runDecision(id);
    } catch (err) {
      console.error("perception failed", err);
    }
  }

  private async runDecision(id: string): Promise<void> {
    const ticket = this.game.beginDecision(id);
    if (!ticket) return;
    try {
      const response = await decide({
        caption: ticket.caption,
        zone: ticket.zone,
        distance: ticket.distance,
        speedKmh: ticket.speedKmh,
      });
      this.game.applyDecision(id, ticket.seq, response);
    } catch (err) {
      console.error("decision failed", err);
    }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load image ${url.slice(0, 60)}`));
    img.src = url;
  });
}
