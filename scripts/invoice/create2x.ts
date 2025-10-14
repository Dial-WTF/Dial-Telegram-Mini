// scripts/create2x.ts
// Minimal CREATE2 address calculator tailored for your CreateX guard:
//   guardedSalt = keccak256(bytes32(rawSalt))
//
// Deps: pnpm add -D tsx && pnpm add viem
//
// CLI:
//   pnpm tsx scripts/create2x.ts \
//     --deployer 0xFactory \
//     --salt 0xRawSalt \
//     --init  0xCreationBytecode \
//     [--fn <creatx|viem|minimal>] [--verbose]
//
// Notes:
//   - --deployer must be the FACTORY (the CREATE2 caller), not your EOA.
//   - --salt is the RAW salt your app passes to the factory; we guard it here.
//   - --init is the CREATION bytecode (with constructor args), not runtime.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getAddress,
  keccak256,
  toHex,
  concatHex,
  isHex,
  type Hex,
} from "viem";

/* ---------- tiny hex utils ---------- */
const strip0x = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
const add0x = (s: string) => (s.startsWith("0x") ? s : `0x${s}`);
const padLeft = (hex: string, bytes: number) => {
  const n = strip0x(hex);
  const want = bytes * 2;
  if (n.length > want) throw new Error(`value too long (got ${n.length / 2} bytes, want ${bytes})`);
  return add0x(n.padStart(want, "0"));
};
const toHexFromUint8 = (u: Uint8Array) =>
  add0x([...u].map(b => b.toString(16).padStart(2, "0")).join(""));

/* ---------- calc variants (kept small & dependable) ---------- */
export function computeCreate2AddressViem(params: {
  deployer: string;              // factory (CREATE2 caller)
  salt: string | number | bigint | Uint8Array; // must be 32B once padded
  initCode: string | Uint8Array; // creation bytecode (+ constructor args)
}): string {
  const deployer = getAddress(params.deployer);

  let saltHex: Hex;
  if (typeof params.salt === "string") saltHex = add0x(params.salt) as Hex;
  else if (typeof params.salt === "number" || typeof params.salt === "bigint") saltHex = toHex(params.salt) as Hex;
  else saltHex = toHex(params.salt) as Hex;
  saltHex = padLeft(saltHex, 32) as Hex;

  let initHex: Hex;
  if (typeof params.initCode === "string") {
    initHex = add0x(params.initCode) as Hex;
    if (!isHex(initHex)) throw new Error("initCode must be hex or Uint8Array");
  } else {
    initHex = toHex(params.initCode) as Hex;
  }
  const initHash = keccak256(initHex);

  const payload = concatHex(["0xff", deployer as Hex, saltHex, initHash]);
  const full = keccak256(payload);
  const addr = ("0x" + strip0x(full).slice(-40)) as Hex;
  return getAddress(addr);
}

export function computeCreate2AddressMinimal(params: {
  deployer: string;              // factory
  salt: string | number | bigint | Uint8Array;
  initCode: string | Uint8Array;
}): string {
  const deployerNo0x = strip0x(getAddress(params.deployer)).toLowerCase();

  let saltHex =
    typeof params.salt === "string" ? add0x(params.salt)
    : typeof params.salt === "number" || typeof params.salt === "bigint" ? add0x(params.salt.toString(16))
    : toHexFromUint8(params.salt);
  saltHex = padLeft(saltHex, 32);
  const initHex = typeof params.initCode === "string" ? add0x(params.initCode) : toHexFromUint8(params.initCode);
  const initHash = keccak256(initHex as Hex);
  const payload = concatHex(["0xff", deployerNo0x as Hex, saltHex as Hex, initHash]);
  const full = keccak256(payload);
  const raw = ("0x" + strip0x(full).slice(-40)) as Hex;
  return getAddress(raw);
}

/* ---------- CreateX convenience: guard = keccak256(bytes32(rawSalt)) ---------- */
export function computeCreate2AddressCreateX(params: {
  deployer: string;                       // factory (CREATE2 caller)
  rawSalt: string | number | bigint | Uint8Array;
  initCode: string | Uint8Array;
  useMinimal?: boolean;                   // set true to use the minimal variant
}): string {
  // normalize raw salt -> bytes32 then guard
  const toHexAny = (x: any) =>
    typeof x === "string" ? (x.startsWith("0x") ? x : ("0x" + x)) : (toHex(x) as Hex);

  const rawSaltHex = toHexAny(params.rawSalt);
  const salt32     = padLeft(rawSaltHex, 32) as Hex;
  const guarded    = keccak256(salt32); // <-- CreateX's _guard

  return params.useMinimal
    ? computeCreate2AddressMinimal({ deployer: params.deployer, salt: guarded, initCode: params.initCode })
    : computeCreate2AddressViem({    deployer: params.deployer, salt: guarded, initCode: params.initCode });
}

/* ---------- CLI ---------- */
type FnChoice = "creatx" | "viem" | "minimal";

function parseArgs(argv: string[]) {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function usage(exitCode = 1): never {
  const name = basename(process.argv[1] || "create2x.ts");
  console.log(`
Usage:
  pnpm tsx ${name} --deployer 0xFactory --salt <raw-hex|number|bigint> (--init 0xInit | --init-file path) \\
                   [--fn <creatx|viem|minimal>] [--verbose]

Defaults:
  --fn creatx   (applies CreateX guard: keccak256(bytes32(rawSalt)))

Examples:
  # CreateX (recommended): raw salt -> guarded -> CREATE2
  pnpm tsx ${name} --deployer 0xBA5eD0...a5Ed --salt 0x3566...bb94a --init 0x6080...0000 --verbose

  # Plain viem/minimal if you already have the guarded salt:
  pnpm tsx ${name} --deployer 0xBA5eD0...a5Ed --salt 0x4a51...e0af --fn viem --init 0x6080...0000
`);
  process.exit(exitCode);
}

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const deployer = args.deployer;
  const saltArg = args.salt;
  const initHex = args.init;
  const initFile = args["init-file"];
  const fnChoice = (args.fn as FnChoice) || "creatx";
  const verbose = args.verbose === "true";

  if (!deployer || (!initHex && !initFile) || !saltArg) usage(1);

  // parse salt (raw for creatx; guarded if you use --fn viem/minimal intentionally)
  let salt: string | number | bigint | Uint8Array = saltArg!;
  if (!/^0x[0-9a-fA-F]+$/.test(saltArg!)) {
    try { salt = BigInt(saltArg!); } catch { /* keep as string */ }
  }

  // load init code
  let initCode: string | Uint8Array;
  if (initFile) {
    const fileBuf = readFileSync(initFile);
    const text = fileBuf.toString("utf8").trim();
    if (/^[0-9a-fA-F]+$/.test(text))      initCode = add0x(text);
    else if (/^0x[0-9a-fA-F]+$/.test(text)) initCode = text as Hex;
    else                                    initCode = new Uint8Array(fileBuf);
  } else {
    initCode = add0x(initHex!);
  }

  if (verbose) {
    if (fnChoice === "creatx") {
      const rawSaltHex = typeof salt === "string" ? add0x(salt) : toHex(salt as any);
      const salt32 = padLeft(rawSaltHex, 32) as Hex;
      const guarded = keccak256(salt32);
      const initHash = keccak256(typeof initCode === "string" ? (initCode as Hex) : (toHex(initCode) as Hex));
      console.log("deployer (factory):", getAddress(deployer));
      console.log("raw salt          :", rawSaltHex);
      console.log("raw salt (bytes32):", salt32);
      console.log("guarded salt      :", guarded, "(= keccak256(bytes32(rawSalt)))");
      console.log("initCodeHash      :", initHash);
    } else {
      const initHash = keccak256(typeof initCode === "string" ? (initCode as Hex) : (toHex(initCode) as Hex));
      console.log("deployer (factory):", getAddress(deployer));
      console.log("salt (as provided):", typeof salt === "string" ? add0x(salt) : toHex(salt as any));
      console.log("initCodeHash      :", initHash);
    }
  }

  let out: string;
  if (fnChoice === "creatx") {
    out = computeCreate2AddressCreateX({ deployer, rawSalt: salt, initCode, useMinimal: false });
  } else if (fnChoice === "viem") {
    out = computeCreate2AddressViem({ deployer, salt, initCode });
  } else if (fnChoice === "minimal") {
    out = computeCreate2AddressMinimal({ deployer, salt, initCode });
  } else {
    console.error(`Unknown --fn ${fnChoice}. Use "creatx" | "viem" | "minimal".`);
    usage(1);
  }

  console.log(out);
}


// pnpm tsx scripts/create2x.ts \
// --deployer 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed \
// --salt 0x35661c512eb2892856242a6c2cc57885ae05fb63a347e3d3dad59117281bb94a \
// --init 0x608060405260405161041c38038061041c83398181016040528101906100259190610285565b5f4790505f8111156100a0578573ffffffffffffffffffffffffffffffffffffffff1663b868980b82878787876040518663ffffffff1660e01b81526004016100719493929190610388565b5f604051808303818588803b158015610088575f5ffd5b505af115801561009a573d5f5f3e3d5ffd5b50505050505b5050505050506103d2565b5f604051905090565b5f5ffd5b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100e5826100bc565b9050919050565b6100f5816100db565b81146100ff575f5ffd5b50565b5f81519050610110816100ec565b92915050565b5f5ffd5b5f5ffd5b5f601f19601f8301169050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b6101648261011e565b810181811067ffffffffffffffff821117156101835761018261012e565b5b80604052505050565b5f6101956100ab565b90506101a1828261015b565b919050565b5f67ffffffffffffffff8211156101c0576101bf61012e565b5b6101c98261011e565b9050602081019050919050565b8281835e5f83830152505050565b5f6101f66101f1846101a6565b61018c565b9050828152602081018484840111156102125761021161011a565b5b61021d8482856101d6565b509392505050565b5f82601f83011261023957610238610116565b5b81516102498482602086016101e4565b91505092915050565b5f819050919050565b61026481610252565b811461026e575f5ffd5b50565b5f8151905061027f8161025b565b92915050565b5f5f5f5f5f60a0868803121561029e5761029d6100b4565b5b5f6102ab88828901610102565b95505060206102bc88828901610102565b945050604086015167ffffffffffffffff8111156102dd576102dc6100b8565b5b6102e988828901610225565b93505060606102fa88828901610271565b925050608061030b88828901610102565b9150509295509295909350565b610321816100db565b82525050565b5f81519050919050565b5f82825260208201905092915050565b5f61034b82610327565b6103558185610331565b93506103658185602086016101d6565b61036e8161011e565b840191505092915050565b61038281610252565b82525050565b5f60808201905061039b5f830187610318565b81810360208301526103ad8186610341565b90506103bc6040830185610379565b6103c96060830184610318565b95945050505050565b603e806103de5f395ff3fe60806040525f5ffdfea264697066735822122077be6be685ad6fcaf1b6d92bccd6dd295e63c6ed687d09bc379bc4c7404c18a164736f6c634300081c0033000000000000000000000000fcfbcfc4f5a421089e3df45455f7f4985fe2d6a80000000000000000000000003fd4e6b0505e90c285e16248e736472b53fcee4900000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000e33e222000000000000000000000000003fd4e6b0505e90c285e16248e736472b53fcee4900000000000000000000000000000000000000000000000000000000000000082acc0dca4d3d6144000000000000000000000000000000000000000000000000