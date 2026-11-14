import type { ThresholdSuggestion } from "@trainstack/contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api, queryClient } from "../api";
import { formatDay, localDay, settingsQueryKey } from "../lib/settings";
import { suggestionsQueryKey, suggestionWords } from "../lib/thresholds";
import { refreshAnalysis } from "./settings-data";

export function useThresholdSuggestions() {
  return useQuery({
    queryKey: suggestionsQueryKey,
    queryFn: () => api.thresholds.suggestions({}),
    staleTime: 30_000,
  });
}

async function refreshAfterAnswer() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: suggestionsQueryKey }),
    queryClient.invalidateQueries({ queryKey: settingsQueryKey }),
    refreshAnalysis(),
  ]);
}

export function ThresholdSuggestions({
  suggestions,
}: {
  suggestions: readonly ThresholdSuggestion[];
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul className="threshold-suggestions" aria-label="Detected thresholds">
      {suggestions.map((suggestion) => (
        <li key={suggestion.id}>
          <SuggestionCard suggestion={suggestion} />
        </li>
      ))}
    </ul>
  );
}

function SuggestionCard({ suggestion }: { suggestion: ThresholdSuggestion }) {
  const accept = useMutation({
    mutationFn: (from: "today" | "effort") => api.thresholds.accept({ id: suggestion.id, from }),
    onSuccess: refreshAfterAnswer,
  });
  const dismiss = useMutation({
    mutationFn: () => api.thresholds.dismiss({ id: suggestion.id }),
    onSuccess: refreshAfterAnswer,
  });
  const words = suggestionWords(suggestion);
  const busy = accept.isPending || dismiss.isPending;
  const failed = accept.isError || dismiss.isError;
  const backdated = suggestion.effortDay !== localDay(new Date());
  return (
    <div className="zone-prompt threshold-suggestion">
      <p className="lede">
        <strong>{words.headline}</strong>,{" "}
        <Link to="/activities/$id" params={{ id: suggestion.activityId }}>
          {words.source}
        </Link>
        . {words.confidence} {words.current}
      </p>
      <div className="suggestion-actions">
        <button
          type="button"
          className="compact"
          disabled={busy}
          onClick={() => accept.mutate("today")}
        >
          Use from today
        </button>
        {backdated && (
          <button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => accept.mutate("effort")}
          >
            Use from {formatDay(suggestion.effortDay)}
          </button>
        )}
        <button
          type="button"
          className="secondary compact"
          disabled={busy}
          onClick={() => dismiss.mutate()}
        >
          Dismiss
        </button>
      </div>
      {failed && (
        <p className="notice" role="alert">
          Not saved. It may have changed; reload and try again.
        </p>
      )}
    </div>
  );
}
