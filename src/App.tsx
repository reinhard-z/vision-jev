import { useEffect, useState } from "react";
import { RoadCanvas } from "./components/RoadCanvas";
import { SampleTray } from "./components/SampleTray";
import { SpeedControl } from "./components/SpeedControl";
import { ThoughtsPanel } from "./components/ThoughtsPanel";
import { Game } from "./game/engine";
import { SessionStatus } from "./components/SessionStatus";
import { loadVision } from "./perception/perceive";
import { Pipeline } from "./pipeline";

export function App() {
  const [game] = useState(() => new Game());
  const [pipeline] = useState(() => new Pipeline(game));

  // Start downloading the vision model right away, not on the first drop.
  useEffect(loadVision, []);

  useEffect(() => {
    // Dev-only handle for poking at the game from the console.
    if (import.meta.env.DEV) (window as unknown as { __jev: unknown }).__jev = { game, pipeline };
    return pipeline.attach();
  }, [game, pipeline]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Jev Driver <span>can Jev drive a car?</span>
        </h1>
        <SpeedControl game={game} />
      </header>
      <SessionStatus />
      <main className="layout">
        <SampleTray pipeline={pipeline} />
        <RoadCanvas game={game} pipeline={pipeline} />
        <ThoughtsPanel game={game} />
      </main>
    </div>
  );
}
