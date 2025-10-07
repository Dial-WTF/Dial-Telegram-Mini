type Address = `0x${string}` | string;

function getAlchemyConfig() {
  const apiKey = (process.env.ALCHEMY_WEBHOOK_AUTH_ACCESS_KEY || process.env.ALCHEMY_API_KEY) as string;
  if (!apiKey) throw new Error('Missing ALCHEMY_API_KEY');
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const network = (process.env.ALCHEMY_NETWORK || 'ETH_MAINNET').toString();
  const webhookUrl = `${baseUrl}/api/webhooks/alchemy`;
  return { apiKey, network, webhookUrl };
}

export async function createAddressActivityWebhook(opts?: { addresses?: Address[]; network?: string; webhookUrl?: string }) {
  const { apiKey, network: netDefault, webhookUrl: urlDefault } = getAlchemyConfig();
  const network = opts?.network || netDefault;
  const webhookUrl = opts?.webhookUrl || urlDefault;
  const addresses: string[] = (opts?.addresses || []).map((a) => a.toString().toLowerCase());
  const res = await fetch('https://dashboard.alchemy.com/api/create-webhook', {
    method: 'POST',
    headers: { 'X-Alchemy-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ network, webhook_type: 'ADDRESS_ACTIVITY', webhook_url: webhookUrl, addresses }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alchemy create-webhook ${res.status}: ${text}`);
  return JSON.parse(text);
}

export async function updateWebhookAddresses(input: { webhookId: string; add?: Address[]; remove?: Address[] }) {
  const { apiKey } = getAlchemyConfig();
  const addresses_to_add = (input.add || []).map((a) => a.toString().toLowerCase());
  const addresses_to_remove = (input.remove || []).map((a) => a.toString().toLowerCase());
  const res = await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
    method: 'PATCH',
    headers: { 'X-Alchemy-Token': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ webhook_id: input.webhookId, addresses_to_add, addresses_to_remove }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Alchemy update-webhook-addresses ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}


