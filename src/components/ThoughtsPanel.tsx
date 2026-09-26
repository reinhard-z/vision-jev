import { useStore } from "zustand";
import type { Action, DecideResponse } from "../../shared/types";
import { DEBUG } from "../debug";
import type { Game } from "../game/engine";
import { STOP_SIGN_WAIT_S } from "../game/constants";
import { ZONE_LABEL, type Decision, type ObjectSnapshot } from "../game/types";
import { visionStore } from "../perception/perceive";

export function ThoughtsPanel({ game }: { game: Game }) {
  const objects = useStore(game.ui, (s) => s.cards);

  return (
    <section className="thoughts" aria-labelledby="thoughts-title">
      <h2 id="thoughts-title">Thoughts</h2>
      <LatestDecision cards={objects} />
      {objects.length === 0 && <p className="hint">Drop something on the road to see what the car thinks.</p>}
      {objects.map((o) => (
        <ThoughtCard key={o.id} obj={o} />
      ))}
    </section>
  );
}

/** Announces each new decision to screen readers; the cards themselves update too often. */
function LatestDecision({ cards }: { cards: ObjectSnapshot[] }) {
  const latest = cards.find((c) => c.phase.kind === "decided" && c.decision);
  const text = latest?.decision?.resolved.label ?? "";
  return (
    <p className="sr-only" aria-live="polite">
      {text}
    </p>
  );
}

const pct = (p: number | undefined) => `${Math.round((p ?? 0) * 100)}%`;
const human = (s: string) => s.replace(/_/g, " ");

/** Action names short enough for the bar labels. */
const SHORT: Record<Action, string> = {
  continue: "continue",
  slow_down: "slow down",
  stop: "stop",
  stop_then_go: "stop, go",
  wait_for_green: "wait green",
  go: "go",
  change_speed: "new speed",
};

/** Jev's three most likely actions, most likely first. */
function topActions(r: DecideResponse): [Action, number][] {
  return (Object.entries(r.action.probabilities) as [Action, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3);
}

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
  // Moved: Jev is deciding again, and its previous answer holds until then.
  const stale = o.phase.kind === "deciding" && d !== undefined;

  return (
    <article className={`card ${done ? "card-done" : ""}`}>
      <header>
        <img src={o.imageUrl} alt="" />
        <div>
          <p className="meta">
            {ZONE_LABEL[o.zone]}
            {r && ` · ${human(r.category.choice)} ${pct(r.category.confidence)}`}
            <span className={`chip chip-${status.tone}`}>{status.text}</span>
          </p>
        </div>
      </header>

      {r && (
        <>
          <div className={`bars ${stale ? "stale" : ""}`}>
            {topActions(r).map(([a, p]) => (
              <Bar key={a} label={SHORT[a]} value={p} chosen={a === r.action.choice} />
            ))}
          </div>
          {r.action.choice === "change_speed" && <p className="detail">Limit read: {r.speedLimit.choice}</p>}
        </>
      )}

      {d && (
        <p className={`behavior ${stale ? "stale" : ""}`}>
          {stale && "Until Jev answers: "}
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

interface BarProps {
  label: string;
  value: number;
  chosen?: boolean;
}

function Bar({ label, value, chosen }: BarProps) {
  return (
    <div className={`bar ${chosen ? "bar-chosen" : ""}`}>
      <span className="bar-label">{label}</span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: pct(value) }} />
      </span>
      <span className="bar-value">{pct(value)}</span>
    </div>
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
