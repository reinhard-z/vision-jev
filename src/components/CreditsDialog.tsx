import { useRef, useState } from "react";
import { loadCredits, type Credit, type Link } from "../credits";

/** "Image credits" button and a modal listing the sample photos' sources and licenses. */
export function CreditsDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [credits, setCredits] = useState<Credit[] | "error" | null>(null);

  const open = () => {
    dialog.current?.showModal();
    if (credits === null || credits === "error") {
      loadCredits().then(setCredits, (err: unknown) => {
        console.error("could not load credits", err);
        setCredits("error");
      });
    }
  };

  return (
    <>
      <button className="link-button" onClick={open}>
        Image credits
      </button>
      <dialog ref={dialog} className="credits" aria-labelledby="credits-title">
        <h2 id="credits-title">Sample image credits</h2>
        <p className="hint">Most photos are from Wikimedia Commons, downscaled to at most 512 px. No other changes.</p>
        {credits === null && <p className="hint">Loading…</p>}
        {credits === "error" && <p className="hint">Couldn't load the credits.</p>}
        {Array.isArray(credits) && (
          <ul>
            {credits.map((c) => (
              <li key={c.file}>
                <LinkOrText value={c.source} />
                {c.author && ` by ${c.author}`}
                {c.license && (
                  <>
                    {", "}
                    <LinkOrText value={c.license} />
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <form method="dialog">
          <button>Close</button>
        </form>
      </dialog>
    </>
  );
}

function LinkOrText({ value }: { value: Link | string }) {
  if (typeof value === "string") return <>{value}</>;
  return (
    <a href={value.url} target="_blank" rel="noreferrer">
      {value.text}
    </a>
  );
}
