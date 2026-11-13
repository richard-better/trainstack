import { MAX_ACTIVITY_FILE_BYTES } from "@trainstack/contract";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { uploads } from "../api";
import { fileSize } from "../lib/activity-file";
import { activityDate } from "../lib/dates";
import { sportName } from "../lib/sports";
import type { Refusal } from "../lib/upload";
import { type Upload, isBusy, isFinished } from "../lib/uploads";
import { SportIcon } from "./sport-icon";

const sizeLimit = `${MAX_ACTIVITY_FILE_BYTES / (1024 * 1024)} MB`;

export function useUploads() {
  return useSyncExternalStore(uploads.subscribe, uploads.list, uploads.list);
}

export function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="secondary" onClick={() => input.current?.click()}>
        <UploadIcon />
        Upload files
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          void uploads.add(files);
        }}
      />
    </>
  );
}

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

export function DropTarget() {
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setOver(true);
    };
    const hover = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      void uploads.add([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", hover);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", hover);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return over ? (
    <div className="drop-target" aria-hidden="true">
      <p className="drop-title">Drop to upload</p>
      <p className="lede">FIT, GPX and TCX files, up to {sizeLimit} each</p>
    </div>
  ) : null;
}

function useWarnBeforeLeaving(busy: boolean) {
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
}

export function UploadList() {
  const list = useUploads();
  useWarnBeforeLeaving(list.some(isBusy));
  if (list.length === 0) return null;
  const finished = list.filter(isFinished).length;

  return (
    <section className="uploads" aria-labelledby="uploads-title">
      <div className="uploads-head">
        <h2 id="uploads-title" className="month-title">
          Uploads
        </h2>
        {finished > 0 && (
          <button type="button" className="quiet" onClick={uploads.clearFinished}>
            Clear finished
          </button>
        )}
      </div>
      <ol className="rows">
        {list.map((upload) => (
          <li key={upload.key}>
            <UploadRow upload={upload} />
          </li>
        ))}
      </ol>
      <ul className="visually-hidden" aria-live="polite">
        {list.filter(isFinished).map((upload) => (
          <li key={upload.key}>
            {upload.name}: {statusOf(upload).text}
          </li>
        ))}
      </ul>
    </section>
  );
}

type Tone = "working" | "done" | "refused";

interface Status {
  readonly text: string;
  readonly tone: Tone;
  readonly progress?: number | null;
}

function refusalText(refusal: Refusal) {
  switch (refusal.kind) {
    case "tooLarge":
      return `Too large. Activity files can be up to ${sizeLimit}.`;
    case "notActivityFile":
      return "Not a FIT, GPX or TCX file.";
    case "noActivity":
      return `This ${refusal.format.toUpperCase()} file has no recorded activity in it, such as a planned route.`;
    case "damaged":
      return `This ${refusal.format.toUpperCase()} file is damaged or incomplete.`;
  }
}

function statusOf({ state }: Upload): Status {
  switch (state.phase) {
    case "waiting":
      return { text: "Waiting", tone: "working", progress: null };
    case "checking":
      return { text: "Checking", tone: "working", progress: null };
    case "sending":
      return {
        text:
          state.progress === null ? "Uploading" : `Uploading ${Math.floor(state.progress * 100)}%`,
        tone: "working",
        progress: state.progress,
      };
    case "failed":
      return { text: "Did not upload. Check your connection and try again.", tone: "refused" };
    case "refused":
      return { text: refusalText(state.refusal), tone: "refused" };
    case "done":
      switch (state.outcome.kind) {
        case "uploaded":
          return { text: "Uploaded", tone: "done" };
        case "alreadyThere":
          return { text: "Already in your account", tone: "done" };
        case "deletedBefore":
          return {
            text: `You deleted this activity on ${activityDate(state.outcome.deletedAt)}, so it was not added again. A deleted activity cannot be brought back.`,
            tone: "refused",
          };
        case "refused":
          return { text: refusalText(state.outcome.refusal), tone: "refused" };
      }
  }
}

function UploadRow({ upload }: { upload: Upload }) {
  const status = statusOf(upload);
  const { state } = upload;
  const activity =
    state.phase === "done" &&
    (state.outcome.kind === "uploaded" || state.outcome.kind === "alreadyThere")
      ? state.outcome.activity
      : null;
  const sport = sportName(upload.sport);

  return (
    <div className={`row upload ${status.tone}`}>
      <span className="row-icon">
        {upload.sport ? <SportIcon family={sport.family} /> : <FileIcon />}
      </span>
      <span className="row-main">
        <span className="row-title">{upload.name}</span>
        <span className="row-meta">
          <span className="upload-status">{status.text}</span>
          <span>{fileSize(upload.size)}</span>
        </span>
      </span>
      <span className="upload-actions">
        {activity && (
          <Link
            to="/activities/$id"
            params={{ id: activity.id }}
            className="secondary link-button compact"
          >
            Open<span className="visually-hidden"> {upload.name}</span>
          </Link>
        )}
        {state.phase === "failed" && (
          <button
            type="button"
            className="secondary compact"
            onClick={() => void uploads.retry(upload.key)}
          >
            Try again
          </button>
        )}
        {(isFinished(upload) || state.phase === "failed") && (
          <button
            type="button"
            className="quiet dismiss"
            onClick={() => uploads.dismiss(upload.key)}
            aria-label={`Dismiss ${upload.name}`}
          >
            <CloseIcon />
          </button>
        )}
      </span>
      {status.progress !== undefined && (
        <span
          className="upload-progress"
          role="progressbar"
          aria-label={`Uploading ${upload.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status.progress === null ? undefined : Math.floor(status.progress * 100)}
        >
          <span
            className={status.progress === null ? "indeterminate" : undefined}
            style={status.progress === null ? undefined : { width: `${status.progress * 100}%` }}
          />
        </span>
      )}
    </div>
  );
}

function Glyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

function UploadIcon() {
  return <Glyph d="M8 10.5v-8m0 0L4.5 6M8 2.5 11.5 6M3 13.5h10" />;
}

function CloseIcon() {
  return <Glyph d="m4 4 8 8m0-8-8 8" />;
}

function FileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 3h8l4 4v14H6Z M14 3v4h4" />
    </svg>
  );
}
