export function measured<T>(run: () => T): { result: T; cpuMilliseconds: number } {
  const before = process.cpuUsage();
  const result = run();
  const { user, system } = process.cpuUsage(before);
  return { result, cpuMilliseconds: (user + system) / 1000 };
}

export const cpuMilliseconds = (run: () => void) => measured(run).cpuMilliseconds;

export const attempts = 3;

export function fastestCpuMilliseconds(run: () => void): number {
  let fastest = Infinity;
  for (let attempt = 0; attempt < attempts; attempt++) {
    fastest = Math.min(fastest, cpuMilliseconds(run));
  }
  return fastest;
}

export function growth(prepare: (size: number) => () => void, small: number, large: number) {
  const smallRun = prepare(small);
  const largeRun = prepare(large);
  return fastestCpuMilliseconds(largeRun) / fastestCpuMilliseconds(smallRun);
}

export const repeats = 5;

function medianCpuMilliseconds(run: () => void): number {
  run();
  const times = Array.from({ length: repeats }, () => cpuMilliseconds(run)).sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

export function growthExponent(
  prepare: (size: number) => () => void,
  sizes: readonly number[],
): number {
  const largest = prepare(Math.max(...sizes));
  for (let warmUp = 0; warmUp < repeats; warmUp++) largest();
  const points = sizes.map((size) => {
    const run = prepare(size);
    return { x: Math.log(size), y: Math.log(medianCpuMilliseconds(run)) };
  });
  const meanX = points.reduce((sum, { x }) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, { y }) => sum + y, 0) / points.length;
  const covariance = points.reduce((sum, { x, y }) => sum + (x - meanX) * (y - meanY), 0);
  const variance = points.reduce((sum, { x }) => sum + (x - meanX) ** 2, 0);
  return covariance / variance;
}
