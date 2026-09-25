import { useEffect, useState } from "react";
import { ACTIONS } from "../../shared/types";
import { SAFETY_PERSON_THRESHOLD } from "../game/behaviors";
import type { Game } from "../game/engine";
import type { ObjectSnapshot } from "../game/types";

const MAX_CARDS = 30;

export function ThoughtsPanel({ game }: { game: Game }) {
  const [objects, setObjects] = useState<ObjectSnapshot[]>([]);

  useEffect(
    () =>
      game.events.on("object", (snap) =>
        setObjects((prev) => {
          const rest = prev.filter((o) => o.id !== snap.id);
          return [snap, ...rest].sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_CARDS);
        }),
      ),
    [game],
  );

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
  if (o.removed) return { text: "removed", tone: "muted" };
  if (o.status === "too_late") return { text: "too late", tone: "stop" };
  if (o.passed) return { text: "passed", tone: "muted" };
  if (o.status === "perceiving") return { text: o.caption === undefined ? "perceiving…" : "deciding…", tone: "busy" };
  return { text: "decided", tone: "go" };
}

function ThoughtCard({ obj: o }: { obj: ObjectSnapshot }) {
  const r = o.response;
  const status = statusText(o);
  const kind = o.resolved?.behavior.kind;
  const releaseNote =
    o.released && kind === "stop_sign" ? "Waited 2 s, continued" : o.released && kind === "red_light" ? "Light turned green" : null;

  return (
    <article className={`card ${o.removed || o.passed ? "card-done" : ""}`}>
      <header>
        <img src={o.imageUrl} alt="" />
        <div>
          <p className="caption">{o.caption ?? <em>perceiving…</em>}</p>
          <p className="meta">
            {o.zone}
            {o.distanceBand && ` · ${o.distanceBand}`}
            {r && ` · ${r.category.choice.replace(/_/g, " ")} ${pct(r.category.confidence)}`}
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

      {o.resolved && (
        <p className={`behavior ${o.resolved.safetyOverride ? "override" : ""}`}>
          {o.resolved.safetyOverride && <strong>Safety override: </strong>}
          {o.resolved.label}
          {releaseNote && <span className="release"> · {releaseNote}</span>}
        </p>
      )}
      {o.status === "too_late" && <p className="behavior too-late-note">{o.tooLateReason}</p>}

      {(o.visionMs !== undefined || r) && (
        <p className="latency">
          {o.visionMs !== undefined && `vision ${o.visionMs} ms`}
          {r && ` · Jev ${r.latencyMs} ms`}
        </p>
      )}
    </article>
  );
}
