// scripts/invoice/predictFromPayload.ts
// Predict forwarder CREATE2 address from proxy calldata and minimal inputs.
// Usage:
//   pnpm tsx scripts/invoice/predictFromPayload.ts \
//     --data 0x... --to 0xProxy \
//     [--id <requestId> | --salt 0xRawSalt] \
//     [--network <ethereum|base|sepolia>] [--createx 0xFactory]
//     [--out recovery] [--username <tg>] [--msg "..."]
// Notes:
//   - If --id is provided, salt = keccak256(toHex(`DIAL|<id>|<networkId>`)).
//   - If --salt is provided, it is treated as the RAW salt (CreateX guard applied internally).

// Load .env like Next.js when running via tsx
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadEnvConfig } = require('@next/env');
  loadEnvConfig(process.cwd(), true);
} catch {}

import { getAddress, decodeFunctionData, keccak256, toHex } from 'viem';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { appConfig } from '#/lib/config';
import { buildForwarderInitCode, predictCreate2AddressCreateX } from '#/lib/create2x';
import ForwarderArtifact from '#/lib/contracts/DepositForwarderMinimal/DepositForwarderMinimal.json';

type Args = {
  data: `0x${string}`;
  to: `0x${string}`; // proxy address
  id?: string; // requestId
  salt?: `0x${string}`; // raw salt override
  network?: string; // base|ethereum|sepolia
  createx?: `0x${string}`;
  out?: string; // output path (dir or file). If dir, writes to recovery/invoices style
  username?: string;
  msg?: string;
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
  if (!out.data || !out.to) throw new Error('Usage: --data 0x... --to 0xProxy [--id <requestId> | --salt 0xRawSalt] [--network ...] [--createx 0x...]');
  return out as Args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Decode proxy calldata → forwarder constructor inputs
  const proxyAbi = [
    {
      type: 'function',
      name: 'transferWithReferenceAndFee',
      stateMutability: 'payable',
      inputs: [
        { name: '_to', type: 'address' },
        { name: '_paymentReference', type: 'bytes' },
        { name: '_feeAmount', type: 'uint256' },
        { name: '_feeAddress', type: 'address' },
      ],
      outputs: [],
    },
  ] as const;
  const decoded = decodeFunctionData({ abi: proxyAbi, data: args.data as `0x${string}` });
  const [beneficiary, paymentReferenceHex, feeAmountWei, feeAddress] = decoded.args as [
    `0x${string}`, `0x${string}`, bigint, `0x${string}`
  ];

  // Network → chainId map
  const chainKey = (args.network || appConfig.request.chain || 'ethereum').toLowerCase();
  const NETWORK_ID_BY_CHAIN: Record<string, string> = { base: '8453', ethereum: '1', mainnet: '1', sepolia: '11155111' };
  const networkId = NETWORK_ID_BY_CHAIN[chainKey] || '1';

  // Resolve CreateX (factory)
  const createx = (args.createx || (process.env.CREATEX_ADDRESS || process.env.CREATE_X || '')).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(createx)) throw new Error('Missing CREATEX_ADDRESS (or pass --createx)');

  // Compute salt
  let rawSalt: `0x${string}`;
  if (args.salt) {
    rawSalt = args.salt as `0x${string}`;
  } else if (args.id) {
    rawSalt = keccak256(toHex(`DIAL|${args.id}|${networkId}`)) as `0x${string}`;
  } else {
    throw new Error('Provide either --id <requestId> or --salt 0xRawSalt');
  }

  // Build forwarder initCode from artifact + constructor inputs
  const bytecode = (ForwarderArtifact as any)?.bytecode as `0x${string}`;
  if (!bytecode) throw new Error('Forwarder bytecode missing in artifact');
  const initCode = buildForwarderInitCode({
    requestProxy: getAddress(args.to) as `0x${string}`,
    beneficiary: getAddress(beneficiary) as `0x${string}`,
    paymentReferenceHex: paymentReferenceHex as `0x${string}`,
    feeAmountWei: BigInt(feeAmountWei),
    feeAddress: getAddress(feeAddress) as `0x${string}`,
    bytecode,
  });

  // Predict
  const predicted = predictCreate2AddressCreateX({ deployer: getAddress(createx) as `0x${string}`, rawSalt, initCode });

  // If --out provided, write a recovery JSON in the same format/naming convention
  if (args.out && String(args.out).trim().length > 0) {
    const networkIdStr = networkId;
    const record = {
      requestId: args.id,
      networkId: networkIdStr,
      predictedAddress: predicted,
      salt: rawSalt,
      initCode,
      requestProxy: getAddress(args.to) as `0x${string}`,
      beneficiary: getAddress(beneficiary) as `0x${string}`,
      paymentReferenceHex: paymentReferenceHex as `0x${string}`,
      feeAmountWei: BigInt(feeAmountWei).toString(),
      feeAddress: getAddress(feeAddress) as `0x${string}`,
      telegram: (args.username || args.msg)
        ? {
            username: args.username || undefined,
            commandText: args.msg || undefined,
          }
        : undefined,
      createdAt: new Date().toISOString(),
    } as const;

    const predLower = String(predicted).toLowerCase();
    const userForName = (args.username && args.username.trim()) ? args.username.trim() : 'anon';
    const idForName = args.id || 'noscan';
    const fileName = `invoice-${predLower}-${userForName}-${idForName}.json`;
    const outBase = args.out.trim();
    let outIsDir = true;
    try { outIsDir = !/\.json$/i.test(outBase) || (statSync(outBase).isDirectory()); } catch {}
    if (outIsDir) {
      const fullDir = join(outBase.replace(/\/$/, ''), 'invoices');
      mkdirSync(fullDir, { recursive: true });
      const fullPath = join(fullDir, fileName);
      writeFileSync(fullPath, Buffer.from(JSON.stringify(record, null, 2)));
      console.log(fullPath);
    } else {
      mkdirSync(dirname(outBase), { recursive: true });
      writeFileSync(outBase, Buffer.from(JSON.stringify(record, null, 2)));
      console.log(outBase);
    }
    return;
  }

  // Default: just print the predicted address
  console.log(predicted);
}

main().catch((e) => {
  console.error('[predictFromPayload] error:', e?.message || e);
  process.exit(1);
});


