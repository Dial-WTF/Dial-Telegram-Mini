import { getAddress, encodeAbiParameters, concatHex, keccak256 } from "viem";
import { simulateTenderly } from "./utils/tenderlySimulation";


type TenderlyCfg = {
  username: string;
  project: string;
  key: string;
};

function getTenderly(): TenderlyCfg {
  const username = process.env.TENDERLY_USERNAME as string;
  const project = process.env.TENDERLY_PROJECT as string;
  const key = process.env.TENDERLY_KEY as string;
  if (!username || !project || !key) throw new Error("Missing Tenderly creds (TENDERLY_USERNAME/PROJECT/KEY)");
  return { username, project, key };
}

export type PredictTenderlyInput = {
  networkId: string; // e.g. "1"
  createx: `0x${string}`;
  salt: `0x${string}`;
  initCode: `0x${string}`;
  from: `0x${string}`;
};

export async function predictDestinationTenderly(input: PredictTenderlyInput) {
  // encode deployCreate2(salt, initCode)
  const abi = [
    { type: "function", name: "deployCreate2", stateMutability: "payable", inputs: [
      { name: "salt", type: "bytes32" },
      { name: "initCode", type: "bytes" },
    ], outputs: [{ name: "newContract", type: "address" }] },
  ] as const;
  // manual encoding via viem not necessary; reuse simulateTenderly payload builder in caller if desired
  // Minimal local encoder:
  const { encodeFunctionData } = await import("viem");
  const data = encodeFunctionData({ abi, functionName: "deployCreate2", args: [input.salt, input.initCode] }) as `0x${string}`;

  const res = await simulateTenderly({ networkId: input.networkId, from: input.from, to: input.createx, data });
  const rawOut = res?.transaction?.transaction_info?.call_trace?.output as `0x${string}` | undefined;
  const predicted = rawOut && rawOut.length >= 66 ? getAddress(("0x" + rawOut.slice(-40)) as `0x${string}`) : undefined;
  return { predicted, raw: res };
}

export type BuildPredictInputArgs = {
  networkId: string;
  createx: `0x${string}`;
  from: `0x${string}`;
  // forwarder constructor params
  requestProxy: `0x${string}`;
  beneficiary: `0x${string}`;
  paymentReferenceHex: `0x${string}`;
  feeAmountWei: bigint;
  feeAddress: `0x${string}`;
  // raw salt (factory will guard internally), e.g. keccak256("DIAL|<invoice>|<chainId>")
  salt: `0x${string}`;
  // path to artifacts json for minimal forwarder
  artifact?: { bytecode?: `0x${string}` };
};

export function buildPredictTenderlyInput(args: BuildPredictInputArgs): PredictTenderlyInput {
  const bytecode = args.artifact?.bytecode ?? (process.env.FWD_BYTECODE as `0x${string}`);
  if (!bytecode) throw new Error("Missing forwarder bytecode (artifact.bytecode or FWD_BYTECODE)");
  const encoded = encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "bytes" },
      { type: "uint256" },
      { type: "address" },
    ],
    [
      args.requestProxy,
      args.beneficiary,
      args.paymentReferenceHex,
      args.feeAmountWei,
      args.feeAddress,
    ]
  );
  const initCode = concatHex([bytecode, encoded]) as `0x${string}`;
  return {
    networkId: args.networkId,
    createx: args.createx,
    salt: args.salt,
    initCode,
    from: args.from,
  };
}

export type CreateAlertInput = {
  address: `0x${string}`;
  networkId: string | number;
  minValueWei?: string | bigint;
  channelId: string;
};

async function postWithRetry(url: string, opts: RequestInit, tries = 3, delayMs = 500) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;
    if (res.status >= 500 && i < tries - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    else return res;
  }
  throw new Error('unreachable');
}

export async function createIncomingPaymentAlert(input: CreateAlertInput) {
  const { username, project, key } = getTenderly();
  const url = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/alert`;
  const expressions: any[] = [
    { type: 'network', expression: { network_id: String(input.networkId) } },
    // { type: 'contract_address', expression: { address: (input.address as string).toLowerCase() } },
    { type: 'eth_balance', expression: { address: (input.address as string).toLowerCase(), threshold: '1' , operator: '>='  } },
    { type: 'tx_status', expression: { transaction_success: true } },
  ];
  if (input.minValueWei !== undefined) {
    expressions.push({ type: 'eth_balance', expression: {address: (input.address as string).toLowerCase(), threshold: '1' , operator: '>='  } });
  }
  const payload = {
    name: `Incoming ETH → ${input.address.slice(0, 6)}…${input.address.slice(-4)}`,
    description: 'Dial Pay forwarder deposit (deploy on first payment)',
    enabled: true,
    expressions,
    delivery_channels: [{ id: input.channelId, enabled: true }],
  } as any;
  const res = await postWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Key': key }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tenderly alert error ${res.status}: ${text}`);
  return JSON.parse(text);
}

export async function deleteAlert(alertId: string) {
  const { username, project, key } = getTenderly();
  const url = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/alert/${alertId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { 'X-Access-Key': key } });
  if (!res.ok) throw new Error(`Delete alert failed ${res.status}: ${await res.text()}`);
  return true;
}

export type CreateActionInput = {
  name: string;
  networkId: string;
  triggerAddress: `0x${string}`; // the predicted address to monitor
  createx: `0x${string}`;
  salt: `0x${string}`;
  initCode: `0x${string}`;
  from: `0x${string}`;
};

export async function createDeployActionOnPayment(input: CreateActionInput) {
  const { username, project, key } = getTenderly();
  // First try publishFile variant
  const publishUrl = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/actions/publishFile`;
  const source = `// Do not change function name.\nconst actionFn = async (context, txEvent) => {\n  return;\n};\nmodule.exports = { actionFn };`;
  const publishPayload: any = {
    action: {
      name: input.name,
      description: "Dial Pay: deploy forwarder on first payment",
      source,
      triggerType: "TRANSACTIONSIMPLE",
      runtime: "V2",
      function: "actionFn",
      invocationType: "ASYNC",
      trigger: {
        type: "transaction_simple",
        transaction_simple: {
          network: [String(input.networkId)],
          to: [(input.triggerAddress as string).toLowerCase()],
          status: ["success"],
        },
      },
    },
    deploy: true,
  };
  let res = await fetch(publishUrl, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Access-Key": key }, body: JSON.stringify(publishPayload) });
  if (res.status === 404) {
    // Fallback to web3-actions create
    const createUrl = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/web3-actions`;
    const createPayload: any = {
      name: input.name,
      runtime: "nodejs18.x",
      source,
      publish_source: true,
      triggers: [
        {
          type: "native_transfer",
          network_id: String(input.networkId),
          contract: (input.triggerAddress as string).toLowerCase(),
        },
      ],
      enabled: true,
    };
    res = await fetch(createUrl, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Access-Key": key }, body: JSON.stringify(createPayload) });
  }
  if (!res.ok) throw new Error(`Tenderly action error ${res.status}: ${await res.text()}`);
  return await res.json();
}


