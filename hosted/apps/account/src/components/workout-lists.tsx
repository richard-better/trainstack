import { ORPCError } from "@orpc/client";
import type { StoredWorkout, WorkoutList } from "@trainstack/contract";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "../api";
import { appendedTo, placementFor } from "../lib/library";
import { forgetList, rememberList, useLibrary, useLists, writeList } from "./workout-data";
import { LibraryShell, OwnRow, RowsSkeleton } from "./workout-library";

export function ListsNav({ current }: { current: string }) {
  const lists = useLists();
  const navigate = useNavigate();
  const [naming, setNaming] = useState(false);
  return (
    <div className="lists-nav">
      <p className="library-group">Lists</p>
      {lists.data?.lists.map((list) => (
        <Link
          key={list.id}
          to="/workouts/lists/$listId"
          params={{ listId: list.id }}
          className="library-link"
          aria-current={current === list.id ? "page" : undefined}
        >
          <span className="library-link-name">{list.name}</span>
          <span className="library-count">{list.workoutIds.length}</span>
        </Link>
      ))}
      {lists.isError && (
        <button type="button" className="quiet compact" onClick={() => lists.refetch()}>
          Lists did not load. Try again
        </button>
      )}
      {naming ? (
        <ListNameForm
          label="New list name"
          submit="Create"
          onCancel={() => setNaming(false)}
          onSave={async (name) => {
            const list = await api.workoutLists.put({
              id: crypto.randomUUID(),
              name,
              updatedAt: new Date(),
            });
            rememberList(list);
            setNaming(false);
            await navigate({ to: "/workouts/lists/$listId", params: { listId: list.id } });
          }}
        />
      ) : (
        <button type="button" className="quiet compact new-list" onClick={() => setNaming(true)}>
          New list
        </button>
      )}
    </div>
  );
}

function ListNameForm({
  label,
  submit,
  initial = "",
  onSave,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setFailed(false);
    try {
      await onSave(trimmed);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="list-name-form"
      onSubmit={save}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <label className="visually-hidden" htmlFor="list-name">
        {label}
      </label>
      <input
        id="list-name"
        value={name}
        maxLength={200}
        autoFocus
        placeholder="List name"
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <div className="form-actions">
        <button type="submit" className="primary compact" disabled={saving || !name.trim()}>
          {submit}
        </button>
        <button type="button" className="quiet compact" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {failed && (
        <p role="alert" className="notice form-problem">
          The list was not saved. Try again.
        </p>
      )}
    </form>
  );
}

export function ListPage({ listId }: { listId: string }) {
  const lists = useLists();
  const library = useLibrary();
  const list = lists.data?.lists.find((held) => held.id === listId);
  useCatchUp(list, library);

  if (lists.isPending) {
    return (
      <LibraryShell current={listId}>
        <RowsSkeleton />
      </LibraryShell>
    );
  }
  if (!list) {
    return (
      <LibraryShell current={listId}>
        <div className="state" role="alert">
          <p className="state-title">
            {lists.isError ? "Your lists did not load." : "This list is not in your account."}
          </p>
          {lists.isError ? (
            <button type="button" className="secondary" onClick={() => lists.refetch()}>
              Try again
            </button>
          ) : (
            <p className="lede">It may have been deleted on another device.</p>
          )}
        </div>
      </LibraryShell>
    );
  }
  return (
    <LibraryShell current={listId}>
      <ListHead list={list} />
      {list.workoutIds.length === 0 ? (
        <div className="state empty">
          <p className="state-title">This list is empty.</p>
          <p className="lede">Open a workout and use Add to list to put it here.</p>
          <Link to="/workouts" search={{}} className="secondary link-button">
            See your workouts
          </Link>
        </div>
      ) : (
        <>
          {library.isError && (
            <div className="note inline" role="alert">
              <p className="lede">Some of this list's workouts did not load.</p>
              <button type="button" className="secondary" onClick={() => library.refetch()}>
                Try again
              </button>
            </div>
          )}
          <ListEntries list={list} workouts={library.data?.workouts ?? {}} />
        </>
      )}
    </LibraryShell>
  );
}

function useCatchUp(list: WorkoutList | undefined, library: ReturnType<typeof useLibrary>) {
  const caughtUpFor = useRef<readonly string[] | null>(null);
  const missing =
    list !== undefined &&
    library.data !== undefined &&
    list.workoutIds.some((id) => !library.data.workouts[id]);
  const { refetch, isFetching } = library;
  useEffect(() => {
    if (!list || !missing || isFetching || caughtUpFor.current === list.workoutIds) return;
    caughtUpFor.current = list.workoutIds;
    void refetch();
  }, [list, missing, isFetching, refetch]);
}

function ListHead({ list }: { list: WorkoutList }) {
  const [renaming, setRenaming] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => api.workoutLists.delete({ id: list.id }),
    onSuccess: async () => {
      dialog.current?.close();
      forgetList(list.id);
      await navigate({ to: "/workouts", search: {} });
    },
  });
  return (
    <div className="page-head list-head">
      {renaming ? (
        <ListNameForm
          label="List name"
          submit="Rename"
          initial={list.name}
          onCancel={() => setRenaming(false)}
          onSave={async (name) => {
            await writeList(
              list.id,
              (held) => ({ ...held, name }),
              () => api.workoutLists.put({ id: list.id, name, updatedAt: new Date() }),
            );
            setRenaming(false);
          }}
        />
      ) : (
        <h1 className="page-title">{list.name}</h1>
      )}
      {!renaming && (
        <div className="page-actions">
          <button type="button" className="secondary" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            type="button"
            className="secondary danger"
            onClick={() => dialog.current?.showModal()}
          >
            Delete list
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="confirm"
        aria-labelledby="delete-list-title"
        onClose={() => remove.reset()}
      >
        <h2 id="delete-list-title">Delete {list.name}?</h2>
        <p className="lede">The list goes on every device. Its workouts stay in your library.</p>
        {remove.isError && (
          <p role="alert" className="notice">
            The list was not deleted. Try again.
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="secondary"
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Deleting…" : "Delete list"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function listProblem(error: unknown) {
  if (error instanceof ORPCError && error.code === "LIST_DELETED") {
    return "This list was deleted on another device.";
  }
  if (error instanceof ORPCError && error.code === "WORKOUT_DELETED") {
    return "That workout was deleted on another device.";
  }
  return "The list was not changed. Try again.";
}

function useListWrite(list: WorkoutList) {
  const [failed, setFailed] = useState<string | null>(null);
  function write(order: string[], send: () => Promise<WorkoutList>) {
    setFailed(null);
    writeList(list.id, (held) => ({ ...held, workoutIds: order }), send).catch((error: unknown) =>
      setFailed(listProblem(error)),
    );
  }
  return { failed, write };
}

function ListEntries({
  list,
  workouts,
}: {
  list: WorkoutList;
  workouts: Readonly<Record<string, StoredWorkout>>;
}) {
  const { failed, write } = useListWrite(list);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);

  function move(from: number, to: number) {
    const placement = placementFor(list.workoutIds, from, to);
    if (!placement) return;
    const order = list.workoutIds.filter((_, index) => index !== from);
    order.splice(to, 0, placement.workoutId);
    write(order, () =>
      api.workoutLists.place({ id: list.id, ...placement, updatedAt: new Date() }),
    );
    requestAnimationFrame(() =>
      rows.current[to]?.querySelector<HTMLElement>(".entry-handle")?.focus(),
    );
  }

  function remove(workoutId: string) {
    write(
      list.workoutIds.filter((id) => id !== workoutId),
      () => api.workoutLists.remove({ id: list.id, workoutId, updatedAt: new Date() }),
    );
  }

  function onHandleKey(event: KeyboardEvent, index: number) {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : null;
    if (to === null) return;
    event.preventDefault();
    move(index, to);
  }

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragging !== null) move(dragging, index);
    setDragging(null);
    setOver(null);
  };

  return (
    <>
      {failed && (
        <p role="alert" className="notice list-problem">
          {failed}
        </p>
      )}
      <p className="lede list-hint">
        Drag a workout by its handle, or focus the handle and use the arrow keys, to change the
        order.
      </p>
      <ol className="rows workout-rows list-entries">
        {list.workoutIds.map((workoutId, index) => {
          const stored = workouts[workoutId];
          return (
            <li
              key={workoutId}
              ref={(element) => {
                rows.current[index] = element;
              }}
              className="list-entry"
              data-dragging={dragging === index || undefined}
              data-over={over === index && dragging !== index ? true : undefined}
              onDragOver={(event) => {
                if (dragging === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => onDrop(event, index)}
            >
              <button
                type="button"
                className="entry-handle quiet"
                draggable
                aria-label={`Move ${stored?.name ?? "workout"}, position ${index + 1} of ${list.workoutIds.length}`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", workoutId);
                  setDragging(index);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                onKeyDown={(event) => onHandleKey(event, index)}
              >
                <HandleIcon />
              </button>
              {stored ? (
                <OwnRow summary={stored} stored={stored} />
              ) : (
                <span className="row workout-row skeleton">
                  <span className="thumb-placeholder" />
                  <span className="row-main">
                    <span className="bar" style={{ width: "40%" }} />
                  </span>
                </span>
              )}
              <div className="entry-actions">
                <button
                  type="button"
                  className="quiet compact"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  aria-label={`Move ${stored?.name ?? "workout"} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="quiet compact"
                  disabled={index === list.workoutIds.length - 1}
                  onClick={() => move(index, index + 1)}
                  aria-label={`Move ${stored?.name ?? "workout"} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="quiet compact"
                  onClick={() => remove(workoutId)}
                  aria-label={`Remove ${stored?.name ?? "workout"} from ${list.name}`}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function AddToList({ workoutId }: { workoutId: string }) {
  const lists = useLists();
  const [failed, setFailed] = useState(false);
  const [naming, setNaming] = useState(false);
  function toggle(list: WorkoutList, add: boolean) {
    setFailed(false);
    const without = list.workoutIds.filter((id) => id !== workoutId);
    writeList(
      list.id,
      (held) => ({ ...held, workoutIds: add ? [...without, workoutId] : without }),
      () =>
        add
          ? api.workoutLists.place({
              id: list.id,
              ...appendedTo(list, workoutId),
              updatedAt: new Date(),
            })
          : api.workoutLists.remove({ id: list.id, workoutId, updatedAt: new Date() }),
    ).catch(() => setFailed(true));
  }
  return (
    <details className="menu">
      <summary className="secondary link-button">Add to list</summary>
      <div className="menu-panel">
        {lists.data?.lists.length === 0 && !naming && (
          <p className="lede">You have no lists yet.</p>
        )}
        {lists.data?.lists.map((list) => (
          <label key={list.id} className="menu-check">
            <input
              type="checkbox"
              checked={list.workoutIds.includes(workoutId)}
              onChange={(event) => toggle(list, event.currentTarget.checked)}
            />
            {list.name}
          </label>
        ))}
        {naming ? (
          <ListNameForm
            label="New list name"
            submit="Create and add"
            onCancel={() => setNaming(false)}
            onSave={async (name) => {
              const created = await api.workoutLists.put({
                id: crypto.randomUUID(),
                name,
                updatedAt: new Date(),
              });
              rememberList(created);
              await writeList(
                created.id,
                (held) => ({ ...held, workoutIds: [workoutId] }),
                () =>
                  api.workoutLists.place({
                    id: created.id,
                    workoutId,
                    after: null,
                    updatedAt: new Date(),
                  }),
              );
              setNaming(false);
            }}
          />
        ) : (
          <button type="button" className="quiet compact" onClick={() => setNaming(true)}>
            New list
          </button>
        )}
        {failed && (
          <p role="alert" className="notice">
            The list was not changed. Try again.
          </p>
        )}
      </div>
    </details>
  );
}

function HandleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M5.5 3.5h.01M10.5 3.5h.01M5.5 8h.01M10.5 8h.01M5.5 12.5h.01M10.5 12.5h.01"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
