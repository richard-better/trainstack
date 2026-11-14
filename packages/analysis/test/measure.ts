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
