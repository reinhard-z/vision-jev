import { useEffect, useState } from "react";
import { RoadCanvas } from "./components/RoadCanvas";
import { SampleTray } from "./components/SampleTray";
import { SpeedControl } from "./components/SpeedControl";
import { ThoughtsPanel } from "./components/ThoughtsPanel";
import { Game } from "./game/engine";
import { ensureSession } from "./api/session";
import { loadVision } from "./perception/perceive";
import { Pipeline } from "./pipeline";

export function App() {
  const [game] = useState(() => new Game());
  const [pipeline] = useState(() => new Pipeline(game));

  // Start downloading the vision model right away, not on the first drop.
  useEffect(loadVision, []);
  // Pass the human check while the model downloads, so the first drop doesn't wait for it.
  useEffect(() => {
    ensureSession().catch((err: unknown) => console.error("could not open a session", err));
  }, []);

  useEffect(() => {
    // Dev-only handle for poking at the game from the console.
    if (import.meta.env.DEV) (window as unknown as { __jev: unknown }).__jev = { game, pipeline };
    return pipeline.attach();
  }, [game, pipeline]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Jev Driver <span>a toy, not a self-driving car</span>
        </h1>
        <SpeedControl game={game} />
      </header>
      <main className="layout">
        <SampleTray pipeline={pipeline} />
        <RoadCanvas game={game} pipeline={pipeline} />
        <ThoughtsPanel game={game} />
      </main>
    </div>
  );
}
