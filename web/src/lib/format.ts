export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatScoreBps(value: number): string {
  return formatPercent(value / 100);
}
