import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import "../styles/app.css";
import "./gallery.css";
import {
  type ShowcaseStep,
  type ShowcaseWidth,
  type ShowcaseWorld,
  SHOWCASE_WIDTHS,
  framePath,
  showcaseEntries,
} from "./entries.ts";
import { type Recording, recordingUrl } from "./recording.ts";

type Shown = ShowcaseWidth | "both";

const worlds: readonly ShowcaseWorld[] = ["athlete", "rough-day", "newcomer", "imported"];

const screens = [...new Set(showcaseEntries.map((entry) => entry.screen))];

const stepText = (step: ShowcaseStep) =>
  "click" in step
    ? `clicking “${step.click}”`
    : "fill" in step
      ? `typing ${Object.entries(step.fill)
          .map(([label, text]) => `${text} in ${label}`)
          .join(", ")}`
      : `uploading ${step.upload.join(", ")}`;

function Gallery() {
  const [recordings, setRecordings] = useState<Map<ShowcaseWorld, Recording> | null>(null);
  const [missing, setMissing] = useState<ShowcaseWorld[]>([]);
  const [shown, setShown] = useState<Shown>("both");

  useEffect(() => {
    void Promise.all(
      worlds.map(async (world) => {
        const response = await fetch(recordingUrl(world));
        return [world, response.ok ? ((await response.json()) as Recording) : null] as const;
      }),
    ).then((loaded) => {
      setMissing(loaded.filter(([, recording]) => recording === null).map(([world]) => world));
      setRecordings(
        new Map(
          loaded.flatMap(([world, recording]) => (recording ? [[world, recording] as const] : [])),
        ),
      );
    });
  }, []);

  const recordedAt = recordings?.values().next().value?.at;

  return (
    <div className="showcase">
      <aside className="showcase-index">
        <header className="showcase-brand">
          <img src="/trainstack-logo.svg" alt="" width={24} height={24} />
          <span>Trainstack showcase</span>
        </header>
        <p className="showcase-lede">
          Every screen of the web app, in its real components, answered from a recording of the
          local API.
          {recordedAt && ` Recorded ${new Date(recordedAt).toLocaleString()}.`}
        </p>
        <fieldset className="showcase-widths">
          <legend>Width</legend>
          {(["both", "phone", "desktop"] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="width"
                checked={shown === option}
                onChange={() => setShown(option)}
              />
              {option === "both"
                ? "Both"
                : `${option === "phone" ? "Phone" : "Desktop"} ${SHOWCASE_WIDTHS[option]}`}
            </label>
          ))}
        </fieldset>
        <nav aria-label="Screens">
          {screens.map((screen) => (
            <section key={screen}>
              <h2>{screen}</h2>
              <ul>
                {showcaseEntries
                  .filter((entry) => entry.screen === screen)
                  .map((entry) => (
                    <li key={entry.id}>
                      <a href={`#${entry.id}`}>{entry.title}</a>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      <main className="showcase-entries">
        {missing.length > 0 && (
          <p role="alert" className="notice">
            Nothing is recorded for {missing.join(", ")}. Run <code>bun run showcase</code> from the
            repository root to record every world and serve this page.
          </p>
        )}
        {recordings &&
          showcaseEntries.map((entry) => {
            const recorded = recordings.get(entry.world)?.entries[entry.id];
            return (
              <article key={entry.id} id={entry.id} className="showcase-entry">
                <header>
                  <h2>
                    <span className="showcase-screen">{entry.screen}</span> {entry.title}
                  </h2>
                  <p className="showcase-meta">
                    <code>{entry.route}</code> · {entry.world}
                    {entry.network &&
                      entry.network !== "answers" &&
                      ` · the server ${entry.network}`}
                    {recorded && (
                      <>
                        {" · "}
                        <a href={framePath(entry, recorded.path)} target="_blank" rel="noreferrer">
                          Open alone
                        </a>
                      </>
                    )}
                  </p>
                  {entry.steps && (
                    <p className="showcase-meta">
                      The screenshots show it after {entry.steps.map(stepText).join(", then ")}.
                    </p>
                  )}
                </header>
                {recorded ? (
                  <div className="showcase-frames">
                    {(shown === "both" ? (["phone", "desktop"] as const) : [shown]).map((width) => (
                      <Frame key={width} width={width} src={framePath(entry, recorded.path)} />
                    ))}
                  </div>
                ) : (
                  <p className="notice">
                    Not recorded yet. Run <code>bun run showcase</code> again.
                  </p>
                )}
              </article>
            );
          })}
      </main>
    </div>
  );
}

const FIRST_HEIGHT = 900;

function Frame({ width, src }: { width: ShowcaseWidth; src: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(FIRST_HEIGHT);
  const pixels = SHOWCASE_WIDTHS[width];

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const fit = () => setScale(Math.min(1, element.clientWidth / pixels));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [pixels]);

  function follow() {
    const page = frame.current?.contentDocument?.documentElement;
    if (!page) return;
    const measure = () => setHeight(Math.max(page.scrollHeight, 200));
    measure();
    new ResizeObserver(measure).observe(page);
  }

  return (
    <figure className={`showcase-frame showcase-frame-${width}`}>
      <figcaption>
        {width === "phone" ? "Phone" : "Desktop"} {pixels}
      </figcaption>
      <div ref={holder} className="showcase-viewport" style={{ height: height * scale }}>
        <iframe
          ref={frame}
          title={`${src} at ${pixels} pixels`}
          src={src}
          loading="lazy"
          onLoad={follow}
          style={{ width: pixels, height, transform: `scale(${scale})` }}
        />
      </div>
    </figure>
  );
}

const root = document.getElementById("showcase");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
