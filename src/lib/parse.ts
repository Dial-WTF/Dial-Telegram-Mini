export type ParsedRequest = {
  amount: number | undefined;
  memo: string;
  payeeCandidate?: string;
};

// Parses variations like:
// /request 5 pizza 0xdial.eth
// /request@AlphaDialBot 0.01 gas dial.eth
// /request 20 lunch
export function parseRequest(text: string, botUsername?: string): ParsedRequest {
  const cleaned = String(text || '').trim();
  const atPart = botUsername ? `(?:@${botUsername.replace(/^@/, '')})?` : '(?:@[^\s]+)?';
  const re = new RegExp(`^/request${atPart}\\s+([0-9]*\\.?[0-9]+)(?:\\s+([\\s\\S]*))?$`, 'i');
  const m = cleaned.match(re);
  if (!m) return { amount: undefined, memo: '', payeeCandidate: undefined };

  const amount = Number(m[1]);
  let tail = (m[2] || '').trim();
  if (!tail) return { amount, memo: '', payeeCandidate: undefined };

  const tokens = tail.split(/\s+/);
  const last = tokens[tokens.length - 1];
  let payeeCandidate: string | undefined;
  if (last && (/^0x[0-9a-fA-F]{40}$/.test(last) || /\.[a-z]{2,}$/i.test(last) || /^0x[\w.-]+$/.test(last))) {
    payeeCandidate = last;
    tokens.pop();
  }
  const memo = tokens.join(' ').trim();
  return { amount: Number.isFinite(amount) ? amount : undefined, memo, payeeCandidate };
}


