export interface Span {
  readonly from: number;
  readonly to: number;
}

export interface TimerEvent {
  readonly time: Date | undefined;
  readonly event: string | number | undefined;
  readonly type: string | number | undefined;
}

export interface SamplingRule {
  readonly maxHeldGapSeconds: number;
}

export const samplingRule: SamplingRule = { maxHeldGapSeconds: 30 };

export interface HeldSegments {
  readonly count: number;
  readonly start: Float64Array;
  readonly end: Float64Array;
  readonly record: Int32Array;
}

const stopTypes = new Set(["stop", "stopAll", "stopDisable", "stopDisableAll"]);

export function timerPauses(events: readonly TimerEvent[], startTime: Date): Span[] {
  const timer = events
    .filter(({ event, time }) => event === "timer" && time && Number.isFinite(time.getTime()))
    .map(({ time, type }) => ({
      seconds: (time!.getTime() - startTime.getTime()) / 1000,
      stops: typeof type === "string" && stopTypes.has(type),
      starts: type === "start",
    }))
    .filter(({ stops, starts }) => stops || starts)
    .sort((a, b) => a.seconds - b.seconds);
  const pauses: Span[] = [];
  let stoppedAt: number | null = null;
  for (const { seconds, stops } of timer) {
    if (stops) stoppedAt ??= seconds;
    else if (stoppedAt !== null) {
      if (seconds > stoppedAt) pauses.push({ from: stoppedAt, to: seconds });
      stoppedAt = null;
    }
  }
  if (stoppedAt !== null) pauses.push({ from: stoppedAt, to: Infinity });
  return pauses;
}

export function pausedRecords(elapsed: Float64Array, pauses: readonly Span[]): Uint8Array {
  const paused = new Uint8Array(elapsed.length);
  let pause = 0;
  for (let index = 0; index < elapsed.length; index++) {
    const seconds = elapsed[index]!;
    while (pause < pauses.length && pauses[pause]!.to <= seconds) pause++;
    const current = pauses[pause];
    if (current && current.from < seconds && seconds < current.to) paused[index] = 1;
  }
  return paused;
}

export function overlapsPause(pauses: readonly Span[], from: number, to: number): boolean {
  let low = 0;
  let high = pauses.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (pauses[middle]!.to <= from) low = middle + 1;
    else high = middle;
  }
  return low < pauses.length && pauses[low]!.from < to;
}

export function heldSegments(
  elapsed: Float64Array,
  pauses: readonly Span[],
  rule: SamplingRule = samplingRule,
): HeldSegments {
  const capacity = Math.max(elapsed.length - 1, 0);
  const start = new Float64Array(capacity);
  const end = new Float64Array(capacity);
  const record = new Int32Array(capacity);
  let count = 0;
  const paused = pausedRecords(elapsed, pauses);
  let pause = 0;
  let next = 0;
  for (let index = 0; index < elapsed.length; index++) {
    if (paused[index]) continue;
    next = Math.max(next, index + 1);
    while (next < elapsed.length && paused[next]) next++;
    if (next === elapsed.length) break;
    const from = elapsed[index]!;
    const to = elapsed[next]!;
    const gap = to - from;
    if (!(gap > 0 && gap <= rule.maxHeldGapSeconds)) continue;
    while (pause < pauses.length && pauses[pause]!.to <= from) pause++;
    const until = Math.min(to, pauses[pause]?.from ?? Infinity);
    if (until > from) {
      start[count] = from;
      end[count] = until;
      record[count] = index;
      count++;
    }
  }
  return {
    count,
    start: start.subarray(0, count),
    end: end.subarray(0, count),
    record: record.subarray(0, count),
  };
}
