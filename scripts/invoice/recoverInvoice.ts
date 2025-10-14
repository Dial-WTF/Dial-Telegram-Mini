// scripts/invoice/recoverInvoice.ts
// Rebuild an invoice forwarder record using local Create2 prediction.
// Usage examples:
//   pnpm tsx scripts/invoice/recoverInvoice.ts --id <requestId>
//   pnpm tsx scripts/invoice/recoverInvoice.ts --id <requestId> --msg "/request ..." --username <tg>
//   pnpm tsx scripts/invoice/recoverInvoice.ts --id <requestId> --out recovery

// Load Next.js-style env files (.env, .env.local, .env.*) when running via tsx
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadEnvConfig } = require('@next/env');
  loadEnvConfig(process.cwd(), true);
} catch {}
// Map public → server fallbacks when missing
if (!process.env.REQUEST_API_KEY && process.env.NEXT_PUBLIC_REQUEST_API_KEY) {
  process.env.REQUEST_API_KEY = process.env.NEXT_PUBLIC_REQUEST_API_KEY;
}

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { keccak256, toHex, getAddress } from 'viem';

import { appConfig } from '#/lib/config';
import { fetchPayCalldata, extractForwarderInputs } from '#/lib/requestApi';
import ForwarderArtifact from '#/lib/contracts/DepositForwarderMinimal/DepositForwarderMinimal.json';
import { buildForwarderInitCode, predictCreate2AddressCreateX } from '#/lib/create2x';

type Args = {
  id: string; // requestId
  to?: string; // optional override: beneficiary/payee
  amount?: string; // optional override: human decimal ETH amount
  network?: string; // base|ethereum|sepolia
  networkId?: string; // 1|8453|11155111
  createx?: `0x${string}`;
  proxy?: `0x${string}`; // optional: requestProxy override
  feeAddress?: `0x${string}`; // optional: fee address override (defaults to env/app)
  feeBps?: string; // optional: fee bps override (defaults to env 50)
  paymentRef?: `0x${string}`; // optional: paymentReference hex override
  feeWei?: string; // optional: exact fee amount (wei) override
  msg?: string; // original tg command
  username?: string; // telegram username (for filename and record)
  chatId?: string; // telegram chat id
  chatType?: string; // telegram chat type
  userId?: string; // telegram user id
  out?: string; // output path (dir or file). If dir, writes to <out>/invoices/invoice-<pred>-<user>-<id>.json
};

function parseArgs(argv: string[]): Args {
  const out: any = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  if (!out.id) throw new Error('Missing --id <requestId>');
  return out as Args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const chainKey = (args.network || appConfig.request.chain || 'ethereum').toLowerCase();
  const NETWORK_ID_BY_CHAIN: Record<string, string> = { base: '8453', ethereum: '1', mainnet: '1', sepolia: '11155111' };
  const networkId = args.networkId || NETWORK_ID_BY_CHAIN[chainKey] || '1';

  const createx = (args.createx || (process.env.CREATEX_ADDRESS || process.env.CREATE_X || '')).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(createx)) throw new Error('Missing CREATEX_ADDRESS (or pass --createx)');

  // Try to fetch pay calldata from Request API; allow manual overrides if unavailable
  let fwd: ReturnType<typeof extractForwarderInputs> | null = null;
  try {
    const feeAddressEnv = process.env.FEE_ADDRESS || appConfig.feeAddr || "0x3fd4e6B0505E90C285e16248e736472B53fcEe49";
    const feePercentage = feeAddressEnv ? String(Number(process.env.FEE_BPS || '50') / 10000) : undefined;
    const payJson = await fetchPayCalldata(args.id, { feeAddress: feeAddressEnv, feePercentage, apiKey: appConfig.request.apiKey || process.env.REQUEST_API_KEY });
    fwd = extractForwarderInputs(payJson);
  } catch {}

  if (!fwd) {
    const hint = !process.env.REQUEST_API_KEY ? ' (REQUEST_API_KEY is not set)' : '';
    throw new Error(`Could not fetch pay calldata from Request API${hint}. Provide REQUEST_API_KEY and rerun, or pass full overrides (--proxy --to --amount --paymentRef --feeAddress/--feeWei) if you must proceed without API data.`);
  }

  const salt = keccak256(toHex(`DIAL|${args.id}|${networkId}`));

  const initCode = buildForwarderInitCode({
    requestProxy: fwd.requestProxy,
    beneficiary: fwd.beneficiary,
    paymentReferenceHex: fwd.paymentReferenceHex,
    feeAmountWei: fwd.feeAmountWei,
    feeAddress: fwd.feeAddress,
    bytecode: (ForwarderArtifact as any)?.bytecode as `0x${string}`,
  });

  const predicted = predictCreate2AddressCreateX({ deployer: getAddress(createx) as `0x${string}`, rawSalt: salt, initCode });

  const decVal = fwd.amountWei ? fwd.amountWei.toString(10) : '0';
  const chainIdNum = Number(networkId) || 1;
  const ethereumUri = `ethereum:${predicted}@${chainIdNum}?value=${decVal}`;
  const requestScanUrl = `https://scan.request.network/request/${args.id}`;

  const record = {
    requestId: args.id,
    networkId,
    predictedAddress: predicted,
    salt,
    initCode,
    requestProxy: fwd.requestProxy,
    beneficiary: fwd.beneficiary,
    paymentReferenceHex: fwd.paymentReferenceHex,
    feeAmountWei: fwd.feeAmountWei.toString(),
    feeAddress: fwd.feeAddress,
    amountWei: decVal,
    ethereumUri,
    requestScanUrl,
    telegram: (args.msg || args.username || args.chatId || args.userId)
      ? {
          chatId: args.chatId ? Number(args.chatId) : undefined,
          chatType: args.chatType || undefined,
          userId: args.userId ? Number(args.userId) : undefined,
          username: args.username || undefined,
          commandText: args.msg || undefined,
        }
      : undefined,
    createdAt: new Date().toISOString(),
  } as const;

  const outJson = JSON.stringify(record, null, 2);
  // Compute output path matching bucket naming: invoices/invoice-<predLower>-<usernameOrAnon>-<id>.json
  const predLower = String(predicted).toLowerCase();
  const userForName = (args.username && args.username.trim()) ? args.username.trim() : 'anon';
  const fileName = `invoice-${predLower}-${userForName}-${args.id}.json`;
  const outBase = args.out && args.out.trim().length > 0 ? args.out.trim() : 'recovery';
  let outIsDir = true;
  try { outIsDir = !/\.json$/i.test(outBase) || (statSync(outBase).isDirectory()); } catch {}
  if (outIsDir) {
    const fullDir = join(outBase.replace(/\/$/, ''), 'invoices');
    mkdirSync(fullDir, { recursive: true });
    const fullPath = join(fullDir, fileName);
    writeFileSync(fullPath, Buffer.from(outJson));
    console.log(fullPath);
  } else {
    mkdirSync(dirname(outBase), { recursive: true });
    writeFileSync(outBase, Buffer.from(outJson));
    console.log(outBase);
  }
}

main().catch((e) => {
  console.error('[recoverInvoice] error:', e?.message || e);
  process.exit(1);
});

