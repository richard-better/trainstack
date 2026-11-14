import type { ThresholdSuggestion } from "@trainstack/contract";
import { thresholds } from "@trainstack/zones";

import { formatDay, formatWithUnit, thresholdWord } from "./settings.ts";
import { sportName } from "./sports.ts";

export const suggestionsQueryKey = ["thresholds", "suggestions"] as const;

const effortNouns: Record<ThresholdSuggestion["threshold"], string> = {
  ftp: "ride",
  threshold_pace: "run",
  lactate_threshold_heart_rate: "30 minute effort",
  max_heart_rate: "hardest effort",
};

const confidenceWords: Record<ThresholdSuggestion["confidence"], string> = {
  high: "Your efforts agree and look all-out.",
  medium: "The effort looks all-out.",
  low: "A rough estimate: Trainstack cannot tell whether the effort was all-out. Setting your max heart rate makes it surer.",
};

export function suggestionWords(suggestion: ThresholdSuggestion) {
  const { threshold, sport, value, current, effortDay, confidence } = suggestion;
  const metric = thresholds[threshold].metric;
  const scope = sport === null ? "" : ` for ${sportName(sport).label.toLowerCase()}`;
  return {
    headline: `Your ${thresholdWord(threshold, sport)}${scope} looks like ${formatWithUnit(metric, value, sport)}`,
    source: `from your ${effortNouns[threshold]} on ${formatDay(effortDay)}`,
    confidence: confidenceWords[confidence],
    current:
      current === null
        ? "You have not set it yet."
        : `You have it at ${formatWithUnit(metric, current, sport)}.`,
  };
}

export const suggestionsFor = (
  suggestions: readonly ThresholdSuggestion[],
  names: readonly string[],
  sport: string | null,
) =>
  suggestions.filter(
    (suggestion) =>
      names.includes(suggestion.threshold) &&
      (suggestion.sport === null || suggestion.sport === sport),
  );
