export function formatNumber(value: number): string {
  const precise = Number(value.toPrecision(15));
  return Object.is(precise, -0) ? "0" : String(precise);
}

export function withoutFloatNoise(value: number): number {
  return Number(value.toPrecision(12));
}
