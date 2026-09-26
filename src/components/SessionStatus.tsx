import { useEffect } from "react";
import { useStore } from "zustand";
import { ensureSession, sessionStore } from "../api/session";

/** Explain startup and renewal, with an explicit retry after verification fails. */
export function SessionStatus() {
  const state = useStore(sessionStore, (status) => status.state);

  useEffect(() => {
    retry();
  }, []);

  return (
    <section
      className="human-check"
      data-ready={state === "ready"}
      aria-hidden={state === "ready"}
      inert={state === "ready"}
      aria-label="JEV connection"
    >
      <p role="status">
        {state === "error"
          ? "Couldn’t verify this browser. JEV can’t make driving decisions yet."
          : "Getting JEV ready… Verifying your browser automatically."}
      </p>
      {state === "error" && <button onClick={retry}>Retry verification</button>}
      <div id="human-check-widget" />
    </section>
  );
}

/** Errors are reflected by the session store rather than an unhandled rejection. */
function retry(): void {
  void ensureSession().catch((err: unknown) => console.error("could not open a session", err));
}
