export async function pollUntilPaid(opts: { baseUrl: string; id: string; tries?: number; delayMs?: number; onPaid: () => Promise<void> | void }) {
  const { baseUrl, id, tries = 24, delayMs = 5000, onPaid } = opts;
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise(r => setTimeout(r, delayMs));
      const s = await fetch(`${baseUrl}/api/status?id=${id}`).then(r => r.json());
      if (s?.status === 'paid') {
        await onPaid();
        break;
      }
    } catch {}
  }
}


