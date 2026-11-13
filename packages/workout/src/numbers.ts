export function formatNumber(value: number, decimals = 6): string {
  const rounded = Number(value.toFixed(decimals));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
