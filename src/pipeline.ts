import { decide } from "./api/decide";
import type { Game } from "./game/engine";
import { perceive, type Perception } from "./perception/perceive";

/**
 * Connects the game to perception and decisions:
 * drag -> caption (vision) -> drop -> decision (Jev, with the zone) -> behavior (game).
 */
export class Pipeline {
  /** In-flight decision requests, so a stale one can be cancelled (each call is billed). */
  private inFlight = new Map<string, AbortController>();
  /**
   * Captions by image URL, started when a drag begins so the vision model
   * works while the user picks a spot. An image always gets the same caption,
   * so dropping it again reuses it. Failures are dropped so they can be retried.
   */
  private captions = new Map<string, Promise<Perception>>();

  constructor(private game: Game) {}

  /** Ask again for objects the game flags (a failed request, moved). Returns unsubscribe. */
  attach(): () => void {
    const offNeeds = this.game.events.on("needsDecision", ({ id }) => void this.runDecision(id));
    const offRemoved = this.game.events.on("removed", ({ id }) => this.cancel(id));
    return () => {
      offNeeds();
      offRemoved();
      for (const id of [...this.inFlight.keys()]) this.cancel(id);
    };
  }

  /** Start captioning an image before it is dropped. */
  prefetch(imageUrl: string): void {
    this.caption(imageUrl).catch(() => {}); // reported when it is dropped
  }

  private caption(imageUrl: string): Promise<Perception> {
    let p = this.captions.get(imageUrl);
    if (!p) {
      p = perceive(imageUrl);
      this.captions.set(imageUrl, p);
      p.catch(() => this.captions.delete(imageUrl));
    }
    return p;
  }

  /** Add an image at a canvas position and caption it, unless that has started already. Never rejects. */
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
      const { caption, visionMs } = await this.caption(imageUrl);
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
      const { response, roundTripMs } = await decide({ caption: ticket.caption, zone: ticket.zone }, controller.signal);
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
