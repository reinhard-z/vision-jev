import { devtools } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ObjectSnapshot } from "./types";

const MAX_CARDS = 30;

/**
 * What React shows about the game. Only changes on events (new object,
 * decision, speed limit), never per frame: position and speed stay plain
 * fields on Game, read by the render loop.
 */
export interface UiState {
  /** Thought cards, newest first. */
  cards: ObjectSnapshot[];
  /** Base target speed (slider or speed limit sign). */
  targetKmh: number;
  /** The first object the car reached too late, or null. */
  tooLate: { id: string; reason: string } | null;
}

/** One store per Game, so headless tests and multiple games don't share state. */
export function createUiStore(initial: UiState) {
  // Inspect in Redux DevTools during development; a no-op without the extension.
  return createStore<UiState>()(devtools(() => initial, { name: "Jev Driver", enabled: import.meta.env.DEV }));
}

export type UiStore = ReturnType<typeof createUiStore>;

/** Replace a card in place, or add a new one on top. */
export function upsertCard(cards: ObjectSnapshot[], snap: ObjectSnapshot): ObjectSnapshot[] {
  const i = cards.findIndex((c) => c.id === snap.id);
  if (i === -1) return [snap, ...cards].slice(0, MAX_CARDS);
  return cards.with(i, snap);
}
