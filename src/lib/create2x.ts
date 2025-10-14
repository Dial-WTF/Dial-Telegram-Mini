import { getAddress, keccak256, toHex, concatHex, encodeAbiParameters, type Hex } from 'viem';

// Minimal helpers for CREATE2 address prediction and forwarder initCode building

function strip0x(s: string) { return s.startsWith('0x') ? s.slice(2) : s; }
function add0x(s: string) { return s.startsWith('0x') ? s as `0x${string}` : (`0x${s}` as `0x${string}`); }
function padToBytes32(hex: string): `0x${string}` {
  const n = strip0x(hex);
  if (n.length > 64) throw new Error(`value too long (got ${n.length / 2} bytes, want 32)`);
  return add0x(n.padStart(64, '0'));
}

export type BuildForwarderInitCodeArgs = {
  // forwarder constructor params
  requestProxy: `0x${string}`;
  beneficiary: `0x${string}`;
  paymentReferenceHex: `0x${string}`;
  feeAmountWei: bigint;
  feeAddress: `0x${string}`;
  // bytecode for the minimal forwarder
  bytecode?: `0x${string}`;
};

export function buildForwarderInitCode(args: BuildForwarderInitCodeArgs): `0x${string}` {
  const bytecode = (args.bytecode as `0x${string}`) || (process.env.FWD_BYTECODE as `0x${string}`);
  if (!bytecode) throw new Error('Missing forwarder bytecode (args.bytecode or FWD_BYTECODE env)');
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'bytes' },
      { type: 'uint256' },
      { type: 'address' },
    ],
    [
      args.requestProxy,
      args.beneficiary,
      args.paymentReferenceHex,
      args.feeAmountWei,
      args.feeAddress,
    ]
  );
  return concatHex([bytecode, encoded]) as `0x${string}`;
}

export function predictCreate2AddressCreateX(params: {
  deployer: `0x${string}`;        // factory (CREATE2 caller)
  rawSalt: string | number | bigint | Uint8Array; // raw salt; CreateX guards internally as keccak256(bytes32(rawSalt))
  initCode: `0x${string}` | Uint8Array;           // creation bytecode (+ constructor args)
}): `0x${string}` {
  const deployer = getAddress(params.deployer);

  // Normalize raw salt -> bytes32 -> guard
  const rawSaltHex: Hex = typeof params.rawSalt === 'string'
    ? (params.rawSalt.startsWith('0x') ? (params.rawSalt as Hex) : (add0x(params.rawSalt) as Hex))
    : (toHex(params.rawSalt) as Hex);
  const salt32 = padToBytes32(rawSaltHex);
  const guardedSalt = keccak256(salt32);

  // Normalize init code
  const initHex: Hex = typeof params.initCode === 'string' ? (params.initCode as Hex) : (toHex(params.initCode) as Hex);
  const initHash = keccak256(initHex);

  const payload = concatHex(['0xff' as Hex, deployer as Hex, guardedSalt as Hex, initHash as Hex]);
  const full = keccak256(payload);
  const addr = add0x(strip0x(full).slice(-40)) as `0x${string}`;
  return getAddress(addr);
}


