

type SimulateArgs = {
  networkId: string; // "1"
  from: `0x${string}`;
  to: `0x${string}`; // CreateX address
  data: `0x${string}`; // encoded computeCreate2Address(bytes32,bytes32)
  blockNumber?: number;
};

export async function simulateTenderly(args: SimulateArgs): Promise<any> {
  const username = process.env.TENDERLY_USERNAME as string;
  const project = process.env.TENDERLY_PROJECT as string;
  const key = process.env.TENDERLY_KEY as string;
  if (!username || !project || !key) throw new Error("Missing Tenderly envs");

  const url = `https://api.tenderly.co/api/v1/account/${username}/project/${project}/simulate`;

  const body = {
    network_id: args.networkId,
    from: args.from,
    to: args.to,
    input: args.data,
    gas: 500000,
    block_number: args.blockNumber,
    value: "0",
    save: false,
    save_if_fails: true,
    simulation_type: "full",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Access-Key": key,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Tenderly simulate failed ${res.status}: ${txt}`);
  }
  return await res.json();
}


