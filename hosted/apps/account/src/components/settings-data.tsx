import { ORPCError } from "@orpc/client";
import type { SettingWrite } from "@trainstack/contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";

import { activitiesQueryKey, api, queryClient } from "../api";
import {
  changeSummary,
  type Overruled,
  overruled,
  type SettingsHistory,
  settingsQueryKey,
  withAnswer,
} from "../lib/settings";

export function useSettingsHistory() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => api.settings.history({}),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });
}

export async function refreshAnalysis() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["activity"] }),
    queryClient.invalidateQueries({ queryKey: activitiesQueryKey }),
    queryClient.invalidateQueries({ queryKey: ["training"] }),
    queryClient.invalidateQueries({ queryKey: ["settings", "zones"] }),
  ]);
}

type Outcome =
  | { kind: "saved" }
  | { kind: "overruled"; overruled: Overruled[] }
  | { kind: "failed"; reason: string | null };

type Writer = {
  save: (writes: SettingWrite[], options?: { onSaved?: () => void }) => void;
  saving: boolean;
  settled: number;
  outcome: Outcome | null;
};

const WriterContext = createContext<Writer | null>(null);

export function useWriter() {
  const writer = useContext(WriterContext);
  if (!writer) throw new Error("useWriter needs a SettingsWriter");
  return writer;
}

export function SettingsWriter({ children }: { children: ReactNode }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [settled, setSettled] = useState(0);
  const write = useMutation({
    mutationFn: async ({ writes }: { writes: SettingWrite[]; onSaved?: () => void }) =>
      api.settings.write({ writes }),
    onMutate: () => setOutcome(null),
    onSuccess: async (answer, { writes, onSaved }) => {
      queryClient.setQueryData<SettingsHistory>(
        settingsQueryKey,
        (history) => history && withAnswer(history, answer),
      );
      const lost = overruled(writes, answer);
      setOutcome(lost.length > 0 ? { kind: "overruled", overruled: lost } : { kind: "saved" });
      onSaved?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingsQueryKey }),
        refreshAnalysis(),
      ]);
    },
    onSettled: () => setSettled((count) => count + 1),
    onError: (error) => {
      const reason =
        error instanceof ORPCError && error.code === "INVALID_SETTING"
          ? String((error.data as { reason?: string } | undefined)?.reason ?? "")
          : null;
      setOutcome({ kind: "failed", reason: reason || null });
    },
  });

  const writer: Writer = {
    save: (writes, options) => write.mutate({ writes, onSaved: options?.onSaved }),
    saving: write.isPending,
    settled,
    outcome,
  };
  return <WriterContext.Provider value={writer}>{children}</WriterContext.Provider>;
}

export function SaveStatus() {
  const { saving, outcome } = useWriter();
  return (
    <div className="save-status" role="status" aria-live="polite">
      {saving ? (
        <p className="lede">Saving…</p>
      ) : outcome?.kind === "saved" ? (
        <p className="lede">Saved.</p>
      ) : outcome?.kind === "failed" ? (
        <p className="notice">
          {outcome.reason
            ? `Not saved: ${outcome.reason}.`
            : "Not saved. Check your connection and try again."}
        </p>
      ) : outcome?.kind === "overruled" ? (
        <div className="notice">
          <p>Another device made a later change, so it was kept instead of yours:</p>
          <ul>
            {outcome.overruled.map(({ write, kept }) => (
              <li
                key={`${write.day} ${"remove" in write ? JSON.stringify(write.key) : changeSummary(write.change)}`}
              >
                {kept
                  ? changeSummary(kept.change)
                  : `${"remove" in write ? "" : changeSummary(write.change)}, removed on the other device`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
