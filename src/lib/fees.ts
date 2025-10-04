export function bpsToPercentString(bps: number | string | undefined): string | undefined {
  if (bps === undefined) return undefined;
  const n = Number(bps);
  if (!Number.isFinite(n)) return undefined;
  return (n / 100).toFixed(2);
}


