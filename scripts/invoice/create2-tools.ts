// create2-tools.ts
// Two CREATE2 calculators + a simple CLI, plus salt-guard modes.
// Deps: `viem`
// Run:  pnpm add -D tsx && pnpm add viem

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

/** Helpers (shared) **/
const strip0x = (s: string) => (s.startsWith("0x") ? s.slice(2) : s);
const add0x = (s: string) => (s.startsWith("0x") ? s : `0x${s}`);
const padLeft = (hex: string, bytes: number) => {
  const n = strip0x(hex);
  const want = bytes * 2;
  if (n.length > want) throw new Error(`value too long (got ${n.length / 2} bytes, want ${bytes})`);
  return add0x(n.padStart(want, "0"));
};
const toHexFromUint8 = (u: Uint8Array) =>
  add0x([...u].map((b) => b.toString(16).padStart(2, "0")).join(""));
/** Minimal keccak wrapper returning 0x-hex (reuse viem keccak) */
const keccak256Minimal = (hex: string): Hex => keccak256(add0x(strip0x(hex)) as Hex);

/** EIP-55 checksum (minimal) */
const toChecksumAddress = (addr: string): string => {
  const lower = strip0x(addr).toLowerCase();
  const hash = strip0x(keccak256Minimal(add0x(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
};

/* -------------------- SALT GUARD MODES -------------------- */
// 1) Put near your other types/helpers
const GUARD_MODES = [
  "raw",
  "senderPacked","senderAbi",
  "deployerPacked","deployerAbi",
  "prefixPacked","prefixAbi",
  "doubleKeccak",
] as const;
type GuardMode = typeof GUARD_MODES[number];

// (reuse your existing guardSalt(...) from earlier message if you already added it)
// If you didn’t add it yet, drop in the guardSalt implementation I sent above.

// 2) Add small helper to list candidates
function discoverGuards(
  baseSalt: string | number | bigint | Uint8Array,
  { deployer, caller, prefix, initCode }: { deployer: string; caller?: string; prefix?: string; initCode: string | Uint8Array }
) {
  const results: Array<{mode: GuardMode; guarded: string; addrViem: string; addrMin: string}> = [];
  for (const mode of GUARD_MODES) {
    try {
      const guarded = guardSalt(mode, baseSalt, { deployer, caller, prefix });
      const addrViem = computeCreate2AddressViem({ deployer, salt: guarded, initCode });
      const addrMin  = computeCreate2AddressMinimal({ deployer, salt: guarded, initCode });
      results.push({ mode, guarded, addrViem, addrMin });
    } catch (e) {
      // skip invalid combos (e.g., missing --caller for senderPacked)
    }
  }
  return results;
}
/**
 * Produce the salt actually used by the factory’s CREATE2.
 * - deployer: factory contract (the one that executes CREATE2)
 * - caller: EOA / msg.sender seen by the factory, when guard uses msg.sender
 * - prefix: ascii string or 0x-hex when factory namespaces salts
 */
function guardSalt(
  mode: GuardMode,
  saltInput: string | Uint8Array | bigint | number,
  { deployer, caller, prefix }: { deployer?: string; caller?: string; prefix?: string } = {}
): Hex {
  // normalize base salt -> hex
  let saltHex: Hex;
  if (typeof saltInput === "string") saltHex = add0x(saltInput) as Hex;
  else if (typeof saltInput === "number" || typeof saltInput === "bigint") saltHex = toHex(saltInput) as Hex;
  else saltHex = toHex(saltInput) as Hex;

  if (mode === "raw") return padLeft(saltHex, 32) as Hex;

  const dep = deployer ? getAddress(deployer) : undefined;
  const cal = caller ? getAddress(caller) : undefined;

  const addrPacked = (addr: string) => strip0x(getAddress(addr));          // 20 bytes (no pad)
  const addrAbi32  = (addr: string) => strip0x(padLeft(getAddress(addr), 32)); // 32-byte left-pad

  const salt32 = strip0x(padLeft(saltHex, 32));

  const toBytes32 = (h: string) => strip0x(padLeft(add0x(h), 32));

  const prefixBytes = () => {
    if (!prefix) throw new Error("--guard-prefix required");
    return prefix.startsWith("0x") ? strip0x(prefix) : strip0x(toHex(Buffer.from(prefix, "utf8")));
  };
  const prefix32 = () => toBytes32(add0x(prefixBytes()));

  switch (mode) {
    case "senderPacked": {
      if (!cal) throw new Error("--caller required for senderPacked");
      // abi.encodePacked(address, bytes32)
      return keccak256(("0x" + addrPacked(cal) + salt32) as Hex);
    }
    case "senderAbi": {
      if (!cal) throw new Error("--caller required for senderAbi");
      // abi.encode(address32, bytes32)
      const enc = "0x" + addrAbi32(cal) + salt32;
      return keccak256(enc as Hex);
    }
    case "deployerPacked": {
      if (!dep) throw new Error("--deployer required for deployerPacked");
      return keccak256(("0x" + addrPacked(dep) + salt32) as Hex);
    }
    case "deployerAbi": {
      if (!dep) throw new Error("--deployer required for deployerAbi");
      const enc = "0x" + addrAbi32(dep) + salt32;
      return keccak256(enc as Hex);
    }
    case "prefixPacked": {
      const pre = prefixBytes();
      return keccak256(("0x" + pre + salt32) as Hex);
    }
    case "prefixAbi": {
      const pre32 = prefix32();
      const enc = "0x" + pre32 + salt32;
      return keccak256(enc as Hex);
    }
    case "doubleKeccak": {
      return keccak256(("0x" + salt32) as Hex);
    }
    default:
      throw new Error(`Unknown guard mode: ${mode}`);
  }
}

/* -------------------- CREATE2 calculators (unchanged) -------------------- */
export function computeCreate2AddressViem(params: {
  deployer: string; // 0x...
  salt: string | number | bigint | Uint8Array;
  initCode: string | Uint8Array; // creation bytecode
}): string {
  const deployer = getAddress(params.deployer);

  let saltHex: Hex;
  if (typeof params.salt === "string") {
    saltHex = add0x(params.salt) as Hex;
  } else if (typeof params.salt === "number" || typeof params.salt === "bigint") {
    saltHex = toHex(params.salt) as Hex;
  } else {
    saltHex = toHex(params.salt) as Hex;
  }
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
  deployer: string; // 0x...
  salt: string | number | bigint | Uint8Array;
  initCode: string | Uint8Array; // creation bytecode
}): string {
  const deployerNo0x = strip0x(getAddress(params.deployer)).toLowerCase();
  if (deployerNo0x.length !== 40) throw new Error("deployer must be 20 bytes");

  let saltHex =
    typeof params.salt === "string"
      ? add0x(params.salt)
      : typeof params.salt === "number" || typeof params.salt === "bigint"
      ? add0x(params.salt.toString(16))
      : toHexFromUint8(params.salt);
  saltHex = padLeft(saltHex, 32);

  const initHex =
    typeof params.initCode === "string"
      ? add0x(params.initCode)
      : toHexFromUint8(params.initCode);
  const initHash = keccak256Minimal(initHex);

  const payload = "0xff" + deployerNo0x + strip0x(saltHex) + strip0x(initHash);
  const full = keccak256Minimal(add0x(payload));
  const raw = "0x" + strip0x(full).slice(-40);

  return toChecksumAddress(raw);
}

/* -------------------- CLI -------------------- */
type FnChoice = "viem" | "minimal";

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
  const name = basename(process.argv[1] || "create2-tools.ts");
  console.log(`
Usage:
  pnpm tsx ${name} --deployer 0xFactory --salt <hex|number|bigint> (--init 0xInit | --init-file path) \\
                   --fn <viem|minimal> [--verbose] \\
                   [--guard <raw|senderPacked|senderAbi|deployerPacked|deployerAbi|prefixPacked|prefixAbi|doubleKeccak>] \\
                   [--caller 0xYourEOA] [--guard-prefix "CreateX:" or 0x...]
Notes:
  - --deployer MUST be the factory contract (the address that executes CREATE2).
  - If your factory guards the salt (e.g., _guard(msg.sender, salt)), choose a guard and pass --caller.
  - If you already have the guarded salt (from Tenderly), use --guard raw and pass it to --salt.
Examples:
  pnpm tsx ${name} --deployer 0xFaa... --salt 0x01 --init 0x600060005560016000f3 --fn viem --verbose
  pnpm tsx ${name} --deployer 0xFactory --caller 0xYourEOA --salt 0x40ce...f28d --guard senderPacked --init '0x6080...0000' --fn minimal --verbose
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
  const fnChoice = (args.fn as FnChoice) || "viem";
  const verbose = args.verbose === "true";

  const guardMode = (args.guard as GuardMode) || "raw";
  const discover = args["discover-guard"] === "true";
  const expectedAddr = args["expected-addr"] ? getAddress(args["expected-addr"]) : undefined;
  const expectedSalt = args["expected-salt"] ? add0x(args["expected-salt"]) : undefined;
  const guardPrefix  = args["guard-prefix"];
  const caller       = args["caller"];
  



  if (!deployer || (!initHex && !initFile) || !saltArg) usage(1);
  

  // parse base salt (hex/number/bigint)
  let baseSalt: string | number | bigint | Uint8Array = saltArg!;
  if (!/^0x[0-9a-fA-F]+$/.test(saltArg!)) {
    try { baseSalt = BigInt(saltArg!); } catch { /* keep as string */ }
  }

  // load init code
  let initCode: string | Uint8Array;
  if (initFile) {
    const fileBuf = readFileSync(initFile);
    const text = fileBuf.toString("utf8").trim();
    if (/^[0-9a-fA-F]+$/.test(text)) {
      initCode = add0x(text);
    } else if (/^0x[0-9a-fA-F]+$/.test(text)) {
      initCode = text as Hex;
    } else {
      initCode = new Uint8Array(fileBuf);
    }
  } else {
    initCode = add0x(initHex!);
  }

  if (discover) {
    const rows = discoverGuards(baseSalt, { deployer, caller, prefix: guardPrefix, initCode });
    for (const r of rows) {
      const hitAddr = expectedAddr && (getAddress(r.addrViem) === expectedAddr || getAddress(r.addrMin) === expectedAddr);
      const hitSalt = expectedSalt && r.guarded.toLowerCase() === expectedSalt.toLowerCase();
      const tag = hitAddr || hitSalt ? "  <== MATCH" : "";
      console.log(
        `mode=${r.mode}\n  guardedSalt: ${r.guarded}\n  viem: ${r.addrViem}\n  minimal: ${r.addrMin}${tag}\n`
      );
    }
    process.exit(0);
  }

  // derive guarded salt used by the factory
  const guardedSalt = guardSalt(guardMode, baseSalt, { deployer, caller, prefix: guardPrefix });

  if (verbose) {
    console.log("deployer (factory):", getAddress(deployer));
    if (caller) console.log("caller (EOA)   :", getAddress(caller));
    console.log("guard mode       :", guardMode);
    if (guardPrefix) console.log("guard prefix    :", guardPrefix);
    console.log("base salt        :", typeof baseSalt === "string" ? add0x(String(baseSalt)) : toHex(baseSalt as any));
    console.log("guarded salt(32) :", guardedSalt);
    const initHashPreview = keccak256(typeof initCode === "string" ? (initCode as Hex) : (toHex(initCode) as Hex));
    console.log("initCodeHash     :", initHashPreview);
  }

  // compute address using your chosen function
  const address =
    fnChoice === "minimal"
      ? computeCreate2AddressMinimal({ deployer, salt: guardedSalt, initCode })
      : computeCreate2AddressViem({ deployer, salt: guardedSalt, initCode });

  console.log(address);
}


// pnpm tsx scripts/create2-tools.ts \
//   --deployer 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed \
//   --caller 0xc596B8e0828Bf652146732E5EC218b235f6fC76C \
//   --salt 0x35661c512eb2892856242a6c2cc57885ae05fb63a347e3d3dad59117281bb94a \
//   --discover-guard \
//   --expected-salt 0x4a518c47284e02792dc07cc55e0d72ab3abdcd13772847f371f16ad27b6fe0af \
// --init '0x608060405260405161041c38038061041c83398181016040528101906100259190610285565b5f4790505f8111156100a0578573ffffffffffffffffffffffffffffffffffffffff1663b868980b82878787876040518663ffffffff1660e01b81526004016100719493929190610388565b5f604051808303818588803b158015610088575f5ffd5b505af115801561009a573d5f5f3e3d5ffd5b50505050505b5050505050506103d2565b5f604051905090565b5f5ffd5b5f5ffd5b5f73ffffffffffffffffffffffffffffffffffffffff82169050919050565b5f6100e5826100bc565b9050919050565b6100f5816100db565b81146100ff575f5ffd5b50565b5f81519050610110816100ec565b92915050565b5f5ffd5b5f5ffd5b5f601f19601f8301169050919050565b7f4e487b71000000000000000000000000000000000000000000000000000000005f52604160045260245ffd5b6101648261011e565b810181811067ffffffffffffffff821117156101835761018261012e565b5b80604052505050565b5f6101956100ab565b90506101a1828261015b565b919050565b5f67ffffffffffffffff8211156101c0576101bf61012e565b5b6101c98261011e565b9050602081019050919050565b8281835e5f83830152505050565b5f6101f66101f1846101a6565b61018c565b9050828152602081018484840111156102125761021161011a565b5b61021d8482856101d6565b509392505050565b5f82601f83011261023957610238610116565b5b81516102498482602086016101e4565b91505092915050565b5f819050919050565b61026481610252565b811461026e575f5ffd5b50565b5f8151905061027f8161025b565b92915050565b5f5f5f5f5f60a0868803121561029e5761029d6100b4565b5b5f6102ab88828901610102565b95505060206102bc88828901610102565b945050604086015167ffffffffffffffff8111156102dd576102dc6100b8565b5b6102e988828901610225565b93505060606102fa88828901610271565b925050608061030b88828901610102565b9150509295509295909350565b610321816100db565b82525050565b5f81519050919050565b5f82825260208201905092915050565b5f61034b82610327565b6103558185610331565b93506103658185602086016101d6565b61036e8161011e565b840191505092915050565b61038281610252565b82525050565b5f60808201905061039b5f830187610318565b81810360208301526103ad8186610341565b90506103bc6040830185610379565b6103c96060830184610318565b95945050505050565b603e806103de5f395ff3fe60806040525f5ffdfea264697066735822122077be6be685ad6fcaf1b6d92bccd6dd295e63c6ed687d09bc379bc4c7404c18a164736f6c634300081c0033000000000000000000000000fcfbcfc4f5a421089e3df45455f7f4985fe2d6a80000000000000000000000003fd4e6b0505e90c285e16248e736472b53fcee4900000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000e33e222000000000000000000000000003fd4e6b0505e90c285e16248e736472b53fcee4900000000000000000000000000000000000000000000000000000000000000082acc0dca4d3d6144000000000000000000000000000000000000000000000000'