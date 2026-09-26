import { decide } from "./api/decide";
import type { Game } from "./game/engine";
import { perceive } from "./perception/perceive";

/**
 * Connects the game to perception and decisions:
 * drop -> caption (vision) -> decision (Jev) -> behavior (game).
 */
export class Pipeline {
  /** In-flight decision requests, so a stale one can be cancelled (each call is billed). */
  private inFlight = new Map<string, AbortController>();

  constructor(private game: Game) {}

  /** Re-decide objects the game flags (e.g. moved to another zone). Returns unsubscribe. */
  attach(): () => void {
    const offNeeds = this.game.events.on("needsDecision", ({ id }) => void this.runDecision(id));
    const offRemoved = this.game.events.on("removed", ({ id }) => this.cancel(id));
    return () => {
      offNeeds();
      offRemoved();
      for (const id of [...this.inFlight.keys()]) this.cancel(id);
    };
  }

  /** Add an image at a canvas position and start perceiving it. Never rejects. */
  async spawn(imageUrl: string, x: number, y: number): Promise<void> {
    let image: HTMLImageElement;
    try {
      image = await loadImage(imageUrl);
    } catch (err) {
      console.error("could not load the dropped image", err);
      return;
    }
    const id = this.game.addObject(image, imageUrl, x, y);
    try {
      const { caption, visionMs } = await perceive(imageUrl);
      this.game.setCaption(id, caption, visionMs);
    } catch (err) {
      console.error("perception failed", err);
      this.game.failPerception(id);
      return;
    }
    await this.runDecision(id);
  }

  private async runDecision(id: string): Promise<void> {
    const ticket = this.game.beginDecision(id);
    if (!ticket) return;
    this.cancel(id); // a newer request replaces the old one
    const controller = new AbortController();
    this.inFlight.set(id, controller);
    try {
      const { response, roundTripMs } = await decide(
        { caption: ticket.caption, zone: ticket.zone, distance: ticket.distance, speedKmh: ticket.speedKmh },
        controller.signal,
      );
      this.game.applyDecision(id, ticket.seq, response, roundTripMs);
    } catch (err) {
      if (controller.signal.aborted) return; // cancelled on purpose; the game already moved on
      console.error("decision failed", err);
      this.game.failDecision(id, ticket.seq);
    } finally {
      if (this.inFlight.get(id) === controller) this.inFlight.delete(id);
    }
  }

  private cancel(id: string): void {
    this.inFlight.get(id)?.abort();
    this.inFlight.delete(id);
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
