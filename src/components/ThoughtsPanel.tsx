import { useStore } from "zustand";
import { ACTIONS } from "../../shared/types";
import { DEBUG } from "../debug";
import { SAFETY_PERSON_THRESHOLD } from "../game/behaviors";
import type { Game } from "../game/engine";
import { STOP_SIGN_WAIT_S } from "../game/constants";
import type { Decision, ObjectSnapshot } from "../game/types";
import { visionStore } from "../perception/perceive";

export function ThoughtsPanel({ game }: { game: Game }) {
  const objects = useStore(game.ui, (s) => s.cards);

  return (
    <section className="thoughts">
      <h2>Thoughts</h2>
      {objects.length === 0 && <p className="hint">Drop something on the road to see what the car thinks.</p>}
      {objects.map((o) => (
        <ThoughtCard key={o.id} obj={o} />
      ))}
    </section>
  );
}

const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;
const human = (s: string) => s.replace(/_/g, " ");

function statusText(o: ObjectSnapshot): { text: string; tone: string } {
  switch (o.phase.kind) {
    case "removed":
      return { text: "removed", tone: "muted" };
    case "too_late":
      return { text: "too late", tone: "stop" };
    case "passed":
      return { text: "passed", tone: "muted" };
    case "perceiving":
    case "deciding":
      return { text: `${o.phase.kind}…`, tone: "busy" };
    case "decided":
      if (o.decision?.outcome.kind === "failed") {
        return { text: o.decision.outcome.stage === "perception" ? "vision failed" : "decision failed", tone: "stop" };
      }
      return { text: "decided", tone: "go" };
  }
}

function releaseNote(d: Decision | undefined): string | null {
  if (!d?.released) return null;
  const kind = d.resolved.behavior.kind;
  if (kind === "stop_sign") return `Waited ${STOP_SIGN_WAIT_S} s, continued`;
  if (kind === "red_light") return "Light turned green";
  return null;
}

function ThoughtCard({ obj: o }: { obj: ObjectSnapshot }) {
  const d = o.decision;
  const answered = d?.outcome.kind === "answered" ? d.outcome : undefined;
  const r = answered?.response;
  const status = statusText(o);
  const note = releaseNote(d);
  const done = o.phase.kind === "removed" || o.phase.kind === "passed";

  return (
    <article className={`card ${done ? "card-done" : ""}`}>
      <header>
        <img src={o.imageUrl} alt="" />
        <div>
          <p className="meta">
            {o.zone}
            {o.distanceBand && ` · ${o.distanceBand}`}
            {r && ` · ${human(r.category.choice)} ${pct(r.category.confidence)}`}
            <span className={`chip chip-${status.tone}`}>{status.text}</span>
          </p>
        </div>
      </header>

      {r && (
        <>
          <div className="bars">
            {ACTIONS.map((a) => (
              <div key={a} className={`bar ${a === r.action.choice ? "bar-chosen" : ""}`}>
                <span className="bar-label">{human(a)}</span>
                <span className="bar-track">
                  <span className={`bar-fill fill-${a}`} style={{ width: pct(r.action.probabilities[a]) }} />
                </span>
                <span className="bar-value">{pct(r.action.probabilities[a])}</span>
              </div>
            ))}
            <div className="bar">
              <span className="bar-label">person?</span>
              <span className="bar-track">
                <span className="bar-fill fill-person" style={{ width: pct(r.couldBePerson) }} />
                <span className="bar-threshold" style={{ left: pct(SAFETY_PERSON_THRESHOLD) }} />
              </span>
              <span className="bar-value">{pct(r.couldBePerson)}</span>
            </div>
          </div>
          {r.category.choice === "traffic_light" && <p className="detail">Light: {human(r.lightState.choice)}</p>}
          {r.category.choice === "speed_limit_sign" && <p className="detail">Limit: {r.speedLimit.choice}</p>}
        </>
      )}

      {d && (
        <p className={`behavior ${d.resolved.safetyOverride ? "override" : ""}`}>
          {d.resolved.safetyOverride && <strong>Safety override: </strong>}
          {d.resolved.label}
          {note && <span className="release"> · {note}</span>}
        </p>
      )}
      {o.phase.kind === "too_late" && <p className="behavior too-late-note">{o.phase.reason}</p>}

      {(o.visionMs !== undefined || r) && (
        <p className="latency">
          {o.visionMs !== undefined && (
            <>
              vision {o.visionMs} ms
              {DEBUG && o.caption !== undefined && <VisionInfo caption={o.caption} />}
            </>
          )}
          {r && ` · Jev ${r.latencyMs} ms`}
          {DEBUG && answered?.roundTripMs !== undefined && ` (round trip ${answered.roundTripMs} ms)`}
        </p>
      )}
    </article>
  );
}

/** Debug only: info icon whose tooltip shows what the vision model saw, and which model it was. */
function VisionInfo({ caption }: { caption: string }) {
  const vision = useStore(visionStore);
  const model =
    vision.state === "ready" ? `${vision.model} · ${vision.backend === "webgpu" ? "WebGPU" : "Wasm"}` : "vision model";
  return (
    <span className="info" tabIndex={0} aria-label={`Caption: ${caption.replace(/\.$/, "")}. Model: ${model}`}>
      i
      <span className="tooltip" role="tooltip">
        <span className="tooltip-caption">“{caption}”</span>
        <span className="tooltip-model">{model}</span>
      </span>
    </span>
  );
}
