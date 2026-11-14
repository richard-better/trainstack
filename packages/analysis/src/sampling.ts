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

function grown<Values extends Float64Array | Int32Array>(values: Values, into: Values): Values {
  into.set(values);
  return into;
}

export function heldSegments(
  elapsed: Float64Array,
  pauses: readonly Span[],
  rule: SamplingRule = samplingRule,
): HeldSegments {
  let capacity = Math.max(elapsed.length - 1, 0) + pauses.length;
  let start = new Float64Array(capacity);
  let end = new Float64Array(capacity);
  let record = new Int32Array(capacity);
  let count = 0;
  const hold = (index: number, from: number, to: number) => {
    if (count === capacity) {
      capacity = 2 * capacity + 1;
      start = grown(start, new Float64Array(capacity));
      end = grown(end, new Float64Array(capacity));
      record = grown(record, new Int32Array(capacity));
    }
    start[count] = from;
    end[count] = to;
    record[count] = index;
    count++;
  };
  const paused = pausedRecords(elapsed, pauses);
  let pause = 0;
  for (let index = 0; index + 1 < elapsed.length; index++) {
    if (paused[index]) continue;
    let from = elapsed[index]!;
    const to = elapsed[index + 1]!;
    const gap = to - from;
    if (!(gap > 0 && gap <= rule.maxHeldGapSeconds)) continue;
    while (pause < pauses.length && pauses[pause]!.to <= from) pause++;
    for (let next = pause; next < pauses.length && pauses[next]!.from < to; next++) {
      const { from: stopped, to: started } = pauses[next]!;
      if (stopped > from) hold(index, from, stopped);
      from = Math.max(from, started);
    }
    if (to > from) hold(index, from, to);
  }
  return {
    count,
    start: start.subarray(0, count),
    end: end.subarray(0, count),
    record: record.subarray(0, count),
  };
}
