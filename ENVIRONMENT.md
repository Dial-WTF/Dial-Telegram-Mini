Environment configuration

Required

- PUBLIC_BASE_URL: Public URL hosting the app (e.g. ngrok). Used for all deep links and webhooks.
- BOT_TOKEN: Telegram Bot API token.
- REQUEST_API_KEY: Request Network API key.
- CREATEX_ADDRESS: CreateX factory address for Create2 deployments.
- RPC_URL: JSON-RPC endpoint for the deployment signer.
- PRIVATE_KEY: Hex private key for the signer that calls CreateX.
- ALCHEMY_WEBHOOK_AUTH_ACCESS_KEY: Alchemy Notify API key used for create/update webhook calls.
- ALCHEMY_WEBHOOK_ID: Existing Alchemy webhook id to update addresses.
- NEXT_STORJ_ACCESS_KEY, NEXT_STORJ_SECRET_KEY, NEXT_STORJ_BUCKET, NEXT_STORJ_ENDPOINT: S3-compatible storage for invoice persistence and idempotency markers.

Recommended

- TENDERLY_FROM: Deployer EOA used for address prediction inputs.
- TENDERLY_NETWORK_ID: Network id for predictions (e.g. 1).
- ALCHEMY_NETWORK: ETH_MAINNET (default) or other supported network string.
- FEE_ADDRESS, FEE_BPS: Optional fee destination and basis points for Request pay calldata.
- WEBHOOK_SECRET: Optional shared secret to validate inbound webhooks.
- DEBUG_BOT: Set to 1 for verbose logs.
- BOT_DRY_RUN: Set to 1 to avoid Telegram sends during local testing.

Optional

- TENDERLY_USERNAME, TENDERLY_PROJECT, TENDERLY_KEY, TENDERLY_INVOICE_ALERT_CHANNEL_ID: For legacy Tenderly alert flows.
- PRIVY_APP_ID, PRIVY_APP_SECRET, NEXT_PUBLIC_PRIVY_APP_ID: Mini-app integrations.
- PAYEE_ADDR: Fallback payee if none provided.
- STORJ_LINKSHARING_KEY / LINKSHARING_KEY: Storj Linksharing key for permanent file URLs. Get it from https://app.storj.io/ → Access → Create Access Grant → Enable Linksharing.

Notes

- Request REST base can be overridden with REQUEST_REST_BASE; the status endpoint will auto-try v2 and v1 paths.
- The app persists invoice metadata under invoices/ in S3 and writes idempotency markers in invoices/deploy/.
