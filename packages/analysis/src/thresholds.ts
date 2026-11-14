import { paceDistanceMetres, type ThresholdValues } from "@trainstack/zones";

import { bestEffortDistances } from "./running.ts";

export const thresholdWindowDays = 180;
export const fullValueDays = 28;
export const dailyDecay = 0.001;
export const recentEffortDays = 42;
export const staleEffortDays = 90;

export const twentyMinuteShare = 0.95;
export const criticalPowerDurations = [300, 600, 1200] as const;
export const ftpShareOfCriticalPower = 0.97;
export const plausibleWPrimeJoules = { min: 5000, max: 35_000 } as const;
export const methodAgreement = 0.05;

export const maximalHeartRateShare = { upToAnHour: 0.9, overAnHour: 0.85 } as const;
export const submaximalMargin = 0.05;

export const riegelExponent = 1.06;
export const riegelEffortSeconds = { min: 600, max: 7200 } as const;
export const paceAgreement = 0.03;

export const thresholdEffortSeconds = 1800;
export const thresholdEffortShare = 0.98;
export const thresholdHeartRateAgreementBpm = 4;

export const maxHeartRateOutlierBpm = 10;
export const maxHeartRateAgreementBpm = 3;

export type DetectedThreshold =
  | "ftp"
  | "threshold_pace"
  | "lactate_threshold_heart_rate"
  | "max_heart_rate";

export type ThresholdConfidence = "high" | "medium" | "low";

export type ThresholdMethod =
  | "critical_power"
  | "twenty_minute"
  | "hour"
  | "riegel"
  | "friel_thirty_minute"
  | "observed_max";

export type ThresholdSignal =
  | "heart_rate_maximal"
  | "heart_rate_unclear"
  | "heart_rate_unknown"
  | "curve_plausible"
  | "curve_flat"
  | "curve_steep"
  | "methods_agree"
  | "methods_differ"
  | "hour_effort_higher"
  | "corroborated"
  | "uncorroborated"
  | "spike_discarded"
  | "efforts_aging"
  | "efforts_stale"
  | "reference_uncertain";

export type NoEstimateReason =
  | "no_data"
  | "too_short"
  | "efforts_not_maximal"
  | "needs_threshold"
  | "no_qualifying_effort";

export interface ThresholdEvidence {
  readonly activityId: string;
  readonly day: string;
  readonly statistic: string;
  readonly value: number;
}

export interface ThresholdEstimate {
  readonly sport: string;
  readonly threshold: DetectedThreshold;
  readonly value: number;
  readonly method: ThresholdMethod;
  readonly confidence: ThresholdConfidence;
  readonly activityId: string;
  readonly day: string;
  readonly evidence: readonly ThresholdEvidence[];
  readonly signals: readonly ThresholdSignal[];
}

export interface NoThresholdEstimate {
  readonly sport: string;
  readonly threshold: DetectedThreshold;
  readonly value: null;
  readonly reason: NoEstimateReason;
}

export type ThresholdDetection = ThresholdEstimate | NoThresholdEstimate;

export interface ThresholdActivity {
  readonly id: string;
  readonly day: string;
  readonly sport: string | null;
  readonly indoor?: boolean;
  readonly statistics: Readonly<Record<string, number>>;
}

export interface ThresholdDetectionOptions {
  readonly today: string;
  readonly windowDays?: number;
  readonly current?: ThresholdValues;
}

export const detectedThresholds = (sport: string): readonly DetectedThreshold[] => {
  if (sport === "cycling") return ["ftp", "lactate_threshold_heart_rate", "max_heart_rate"];
  if (sport === "running") {
    return ["threshold_pace", "lactate_threshold_heart_rate", "max_heart_rate"];
  }
  return ["max_heart_rate"];
};

const millisecondsPerDay = 86_400_000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / millisecondsPerDay;

export const effortDecay = (ageDays: number) =>
  1 - dailyDecay * Math.max(0, ageDays - fullValueDays);

type Dated = ThresholdActivity & { readonly age: number };

type Candidate = {
  readonly activity: Dated;
  readonly statistic: string;
  readonly raw: number;
  readonly value: number;
};

const evidenceOf = ({ activity, statistic, raw }: Candidate): ThresholdEvidence => ({
  activityId: activity.id,
  day: activity.day,
  statistic,
  value: raw,
});

const confidenceOrder: readonly ThresholdConfidence[] = ["low", "medium", "high"];
const lower = (confidence: ThresholdConfidence, by = 1): ThresholdConfidence =>
  confidenceOrder[Math.max(0, confidenceOrder.indexOf(confidence) - by)]!;
const atMost = (confidence: ThresholdConfidence, cap: ThresholdConfidence) =>
  confidenceOrder.indexOf(confidence) <= confidenceOrder.indexOf(cap) ? confidence : cap;

function aged(confidence: ThresholdConfidence, ageDays: number, signals: ThresholdSignal[]) {
  if (ageDays > staleEffortDays) {
    signals.push("efforts_stale");
    return "low";
  }
  if (ageDays > recentEffortDays) {
    signals.push("efforts_aging");
    return lower(confidence);
  }
  return confidence;
}

const none = (sport: string, threshold: DetectedThreshold, reason: NoEstimateReason) =>
  ({ sport, threshold, value: null, reason }) satisfies NoThresholdEstimate;

function best(
  activities: readonly Dated[],
  statistic: string,
  decays: boolean,
): Candidate | undefined {
  let found: Candidate | undefined;
  for (const activity of activities) {
    const raw = activity.statistics[statistic];
    if (raw === undefined || !Number.isFinite(raw)) continue;
    const value = decays ? raw * effortDecay(activity.age) : raw;
    if (!found || value > found.value) found = { activity, statistic, raw, value };
  }
  return found;
}

type Effort = "maximal" | "unclear" | "submaximal" | "unknown";

type MaxHeartRate = { readonly value: number; readonly set: boolean };

function effortOf(
  heartRate: number | undefined,
  maxHeartRate: MaxHeartRate | undefined,
  seconds: number,
): Effort {
  if (heartRate === undefined || maxHeartRate === undefined) return "unknown";
  const maximal =
    seconds > 3600 ? maximalHeartRateShare.overAnHour : maximalHeartRateShare.upToAnHour;
  const share = heartRate / maxHeartRate.value;
  if (share < maximal - submaximalMargin) return "submaximal";
  return share >= maximal && maxHeartRate.set ? "maximal" : "unclear";
}

const effortSignal = (effort: Effort): ThresholdSignal =>
  effort === "maximal"
    ? "heart_rate_maximal"
    : effort === "unclear"
      ? "heart_rate_unclear"
      : "heart_rate_unknown";

function detectMaxHeartRate(sport: string, activities: readonly Dated[]): ThresholdDetection {
  const statistic = "sustained_max_heart_rate_bpm";
  const peaks = activities
    .flatMap((activity) => {
      const raw = activity.statistics[statistic];
      return raw === undefined ? [] : [{ activity, statistic, raw, value: raw }];
    })
    .sort((a, b) => b.value - a.value || a.activity.age - b.activity.age);
  if (peaks.length === 0) return none(sport, "max_heart_rate", "no_data");
  const signals: ThresholdSignal[] = [];
  let [top, ...rest] = peaks;
  if (rest[0] && top!.value - rest[0].value > maxHeartRateOutlierBpm) {
    signals.push("spike_discarded");
    [top, ...rest] = rest;
  }
  const agreeing = rest.filter(
    ({ value }) => top!.value - value <= maxHeartRateAgreementBpm,
  ).length;
  signals.push(agreeing > 0 ? "corroborated" : "uncorroborated");
  return {
    sport,
    threshold: "max_heart_rate",
    value: Math.round(top!.value),
    method: "observed_max",
    confidence: agreeing > 0 ? "medium" : "low",
    activityId: top!.activity.id,
    day: top!.activity.day,
    evidence: [evidenceOf(top!)],
    signals,
  };
}

function criticalPower(points: readonly Candidate[], durations: readonly number[]) {
  const n = points.length;
  const works = points.map(({ value }, index) => value * durations[index]!);
  const meanT = durations.reduce((sum, t) => sum + t, 0) / n;
  const meanW = works.reduce((sum, w) => sum + w, 0) / n;
  let covariance = 0;
  let variance = 0;
  durations.forEach((t, index) => {
    covariance += (t - meanT) * (works[index]! - meanW);
    variance += (t - meanT) ** 2;
  });
  const watts = covariance / variance;
  return { watts, wPrimeJoules: meanW - watts * meanT };
}

function detectFtp(
  sport: string,
  activities: readonly Dated[],
  maxHeartRate: MaxHeartRate | undefined,
): ThresholdDetection {
  const power = (seconds: number) => best(activities, `best_power_${seconds}s_w`, true);
  const twentyEffort = power(1200);
  if (!twentyEffort) {
    const anyPower = activities.some((activity) =>
      Object.keys(activity.statistics).some((name) => /^best_power_\d+s_w$/.test(name)),
    );
    return none(sport, "ftp", anyPower ? "too_short" : "no_data");
  }
  const heartRateStatistic = "best_power_1200s_heart_rate_bpm";
  const heartRate = twentyEffort.activity.statistics[heartRateStatistic];
  const effort = effortOf(heartRate, maxHeartRate, 1200);
  if (effort === "submaximal") return none(sport, "ftp", "efforts_not_maximal");

  const signals: ThresholdSignal[] = [effortSignal(effort)];
  const twenty = twentyMinuteShare * twentyEffort.value;
  const curvePoints = criticalPowerDurations
    .map(power)
    .filter((point): point is Candidate => point !== undefined);
  const fit =
    curvePoints.length === criticalPowerDurations.length
      ? criticalPower(curvePoints, criticalPowerDurations)
      : null;
  const plausible =
    fit !== null &&
    fit.wPrimeJoules >= plausibleWPrimeJoules.min &&
    fit.wPrimeJoules <= plausibleWPrimeJoules.max;
  if (fit) {
    signals.push(
      plausible
        ? "curve_plausible"
        : fit.wPrimeJoules < plausibleWPrimeJoules.min
          ? "curve_flat"
          : "curve_steep",
    );
  }

  let method: ThresholdMethod = plausible ? "critical_power" : "twenty_minute";
  let value = fit && plausible ? ftpShareOfCriticalPower * fit.watts : twenty;
  let used: Candidate[] = plausible ? curvePoints : [twentyEffort];
  let key = twentyEffort;
  let confidence: ThresholdConfidence = effort === "maximal" ? "medium" : "low";
  if (plausible) {
    const agree = Math.abs(value - twenty) <= methodAgreement * value;
    signals.push(agree ? "methods_agree" : "methods_differ");
    if (agree && effort === "maximal") confidence = "high";
  }
  confidence = aged(confidence, Math.max(...used.map(({ activity }) => activity.age)), signals);

  const hourEffort = power(3600);
  if (hourEffort && hourEffort.value > value) {
    signals.push("hour_effort_higher");
    method = "hour";
    value = hourEffort.value;
    used = [...used, hourEffort];
    key = hourEffort;
  }

  const evidence = used.map(evidenceOf);
  if (heartRate !== undefined) {
    evidence.push(evidenceOf({ ...twentyEffort, statistic: heartRateStatistic, raw: heartRate }));
  }
  return {
    sport,
    threshold: "ftp",
    value: Math.round(value),
    method,
    confidence,
    activityId: key.activity.id,
    day: key.activity.day,
    evidence,
    signals,
  };
}

export const riegelHourSpeed = (metres: number, seconds: number) =>
  (metres * (3600 / seconds) ** (1 / riegelExponent)) / 3600;

function detectThresholdPace(
  sport: string,
  activities: readonly Dated[],
  maxHeartRate: MaxHeartRate | undefined,
): ThresholdDetection {
  const outdoor = activities.filter(({ indoor }) => !indoor);
  type PaceCandidate = Candidate & { effort: Effort; heartRate: number | undefined };
  const candidates: PaceCandidate[] = [];
  let anyEffort = false;
  for (const activity of outdoor) {
    for (const { name, metres } of bestEffortDistances) {
      const statistic = `best_time_${name}_s`;
      const seconds = activity.statistics[statistic];
      if (seconds === undefined || !(seconds > 0)) continue;
      anyEffort = true;
      if (seconds < riegelEffortSeconds.min || seconds > riegelEffortSeconds.max) continue;
      const heartRate = activity.statistics[`best_time_${name}_heart_rate_bpm`];
      const speed = riegelHourSpeed(metres, seconds);
      candidates.push({
        activity,
        statistic,
        raw: seconds,
        value: speed * effortDecay(activity.age),
        effort: effortOf(heartRate, maxHeartRate, seconds),
        heartRate,
      });
    }
  }
  if (candidates.length === 0)
    return none(sport, "threshold_pace", anyEffort ? "too_short" : "no_data");
  const counted = candidates.filter(({ effort }) => effort !== "submaximal");
  if (counted.length === 0) return none(sport, "threshold_pace", "efforts_not_maximal");
  const top = counted.reduce((a, b) => (b.value > a.value ? b : a));
  const signals: ThresholdSignal[] = [effortSignal(top.effort)];
  const support = counted.find(
    (other) =>
      other.activity.id !== top.activity.id && top.value - other.value <= paceAgreement * top.value,
  );
  signals.push(support ? "corroborated" : "uncorroborated");
  let confidence: ThresholdConfidence =
    top.effort === "maximal" ? (support ? "high" : "medium") : "low";
  confidence = aged(confidence, top.activity.age, signals);
  const evidence = [evidenceOf(top)];
  if (top.heartRate !== undefined) {
    evidence.push(
      evidenceOf({
        ...top,
        statistic: top.statistic.replace(/_s$/, "_heart_rate_bpm"),
        raw: top.heartRate,
      }),
    );
  }
  if (support) evidence.push(evidenceOf(support));
  return {
    sport,
    threshold: "threshold_pace",
    value: Math.round((paceDistanceMetres(sport) ?? 1000) / top.value),
    method: "riegel",
    confidence,
    activityId: top.activity.id,
    day: top.activity.day,
    evidence,
    signals,
  };
}

type Reference = { value: number; confidence: ThresholdConfidence };

function detectThresholdHeartRate(
  sport: string,
  activities: readonly Dated[],
  reference: Reference | null,
): ThresholdDetection {
  const threshold = "lactate_threshold_heart_rate";
  const running = sport === "running";
  const effortStatistic = running
    ? `best_grade_adjusted_speed_${thresholdEffortSeconds}s_mps`
    : `best_power_${thresholdEffortSeconds}s_w`;
  const heartRateStatistic = effortStatistic.replace(/_(mps|w)$/, "_heart_rate_bpm");
  const eligible = activities.filter(
    (activity) =>
      !(running && activity.indoor) &&
      activity.statistics[effortStatistic] !== undefined &&
      activity.statistics[heartRateStatistic] !== undefined,
  );
  if (eligible.length === 0) return none(sport, threshold, "no_data");
  if (!reference) return none(sport, threshold, "needs_threshold");
  const qualifying = eligible
    .filter(
      ({ statistics }) => statistics[effortStatistic]! >= thresholdEffortShare * reference.value,
    )
    .sort((a, b) => a.age - b.age);
  const latest = qualifying[0];
  if (!latest) return none(sport, threshold, "no_qualifying_effort");
  const heartRate = latest.statistics[heartRateStatistic]!;
  const support = qualifying.find(
    (other) =>
      other !== latest &&
      other.age - latest.age <= recentEffortDays &&
      Math.abs(other.statistics[heartRateStatistic]! - heartRate) <= thresholdHeartRateAgreementBpm,
  );
  const signals: ThresholdSignal[] = [support ? "corroborated" : "uncorroborated"];
  let confidence: ThresholdConfidence = support ? "high" : "medium";
  if (reference.confidence !== "high") {
    signals.push("reference_uncertain");
    confidence = atMost(confidence, reference.confidence);
  }
  confidence = aged(confidence, latest.age, signals);
  const candidate = (activity: Dated, statistic: string): Candidate => ({
    activity,
    statistic,
    raw: activity.statistics[statistic]!,
    value: activity.statistics[statistic]!,
  });
  const evidence = [candidate(latest, effortStatistic), candidate(latest, heartRateStatistic)];
  if (support) evidence.push(candidate(support, heartRateStatistic));
  return {
    sport,
    threshold,
    value: Math.round(heartRate),
    method: "friel_thirty_minute",
    confidence,
    activityId: latest.id,
    day: latest.day,
    evidence: evidence.map(evidenceOf),
    signals,
  };
}

function referenceFor(
  sport: string,
  estimate: ThresholdDetection | undefined,
  current: ThresholdValues,
): Reference | null {
  const toSpeed = (pace: number) => (paceDistanceMetres(sport) ?? 1000) / pace;
  const fromEstimate =
    estimate && estimate.value !== null
      ? {
          value: sport === "running" ? toSpeed(estimate.value) : estimate.value,
          confidence: estimate.confidence,
        }
      : null;
  if (fromEstimate && fromEstimate.confidence !== "low") return fromEstimate;
  const set = sport === "running" ? current.threshold_pace : current.ftp;
  if (set !== undefined) {
    return { value: sport === "running" ? toSpeed(set) : set, confidence: "medium" };
  }
  return fromEstimate;
}

export function detectThresholds(
  activities: readonly ThresholdActivity[],
  sport: string,
  { today, windowDays = thresholdWindowDays, current = {} }: ThresholdDetectionOptions,
): ThresholdDetection[] {
  const now = dayNumber(today);
  const dated: Dated[] = activities.flatMap((activity) => {
    const age = now - dayNumber(activity.day);
    return activity.sport === sport && age >= 0 && age <= windowDays ? [{ ...activity, age }] : [];
  });
  const wanted = detectedThresholds(sport);
  const maxHeartRate = detectMaxHeartRate(sport, dated);
  const set = current.max_heart_rate;
  const observed = maxHeartRate.value ?? undefined;
  const maxForEfforts: MaxHeartRate | undefined =
    set !== undefined
      ? { value: Math.max(set, observed ?? set), set: true }
      : observed === undefined
        ? undefined
        : { value: observed, set: false };
  const results: ThresholdDetection[] = [];
  let primary: ThresholdDetection | undefined;
  if (wanted.includes("ftp")) {
    primary = detectFtp(sport, dated, maxForEfforts);
    results.push(primary);
  }
  if (wanted.includes("threshold_pace")) {
    primary = detectThresholdPace(sport, dated, maxForEfforts);
    results.push(primary);
  }
  if (wanted.includes("lactate_threshold_heart_rate")) {
    results.push(detectThresholdHeartRate(sport, dated, referenceFor(sport, primary, current)));
  }
  results.push(maxHeartRate);
  return results;
}
