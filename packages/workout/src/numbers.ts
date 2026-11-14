export function formatNumber(value: number): string {
  const precise = Number(value.toPrecision(15));
  return Object.is(precise, -0) ? "0" : String(precise);
}

export function withoutFloatNoise(value: number): number {
  return Number(value.toPrecision(12));
}

export function describeLength(
  length: { type: "time"; seconds: number } | { type: "distance"; meters: number },
): string {
  return length.type === "time"
    ? `${formatNumber(length.seconds)} s`
    : `${formatNumber(length.meters)} m`;
}
