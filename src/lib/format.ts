export function formatUsd(n: number): string {
  try { return `$${n.toFixed(2)}`; } catch { return `$${n}`; }
}

export function formatCaption(amount: number, note?: string): string {
  const a = formatUsd(amount);
  return `Request: ${a}${note ? ` — ${note}` : ''}`;
}


