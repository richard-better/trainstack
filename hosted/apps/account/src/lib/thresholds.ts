import type { ThresholdSuggestion } from "@trainstack/contract";
import { thresholds, type ZoneMetric } from "@trainstack/zones";

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
  low: "A rough estimate: Trainstack cannot tell whether the effort was all-out.",
};

const observedMaxWords = "It is the highest your heart rate held, so your max is at least this.";

export function suggestionWords(suggestion: ThresholdSuggestion) {
  const { threshold, sport, value, current, effortDay, confidence, method } = suggestion;
  const metric = thresholds[threshold].metric;
  const scope = sport === null ? "" : ` for ${sportName(sport).label.toLowerCase()}`;
  return {
    headline: `Your ${thresholdWord(threshold, sport)}${scope} looks like ${formatWithUnit(metric, value, sport)}`,
    source: `from your ${effortNouns[threshold]} on ${formatDay(effortDay)}`,
    confidence: method === "observed_max" ? observedMaxWords : confidenceWords[confidence],
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
  own: readonly ZoneMetric[],
) =>
  suggestions.filter((suggestion) => {
    if (!names.includes(suggestion.threshold)) return false;
    const metric = thresholds[suggestion.threshold].metric;
    const sportsOwn = metric === "pace" || own.includes(metric);
    return sportsOwn ? sport !== null && suggestion.sport === sport : suggestion.sport === null;
  });
