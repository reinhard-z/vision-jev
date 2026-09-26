import { useStore } from "zustand";
import { MAX_TARGET_KMH, MIN_TARGET_KMH } from "../game/constants";
import type { Game } from "../game/engine";

/** Target speed slider. Speed limit signs move it too. */
export function SpeedControl({ game }: { game: Game }) {
  const target = useStore(game.ui, (s) => s.targetKmh);

  return (
    <label className="speed">
      Target speed <strong>{target} km/h</strong>
      <input
        type="range"
        min={MIN_TARGET_KMH}
        max={MAX_TARGET_KMH}
        step={5}
        value={target}
        onChange={(e) => game.setBaseTarget(Number(e.target.value))}
      />
    </label>
  );
}
