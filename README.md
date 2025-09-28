## Dial Pay — Telegram Mini App (TMA)

Dial-themed Telegram Mini App to create Request Network invoices with a Cash-App style UI. Runs inside Telegram’s webview, validates Telegram `initData` server-side, optionally uses Privy embedded wallets as payee, creates a Request invoice, and exposes a `/pay/[id]` page with QR + live status polling.

### Tech
- **Next.js App Router** (Node runtime for API routes)
- **Telegram SDK**: `@twa-dev/sdk` (dynamic import in client only)
- **Privy**: `@privy-io/react-auth` (embedded wallets)
- **Request Network**: `@requestnetwork/request-client.js`

### Environment
Copy `.env.example` → `.env.local` and fill in values:

```
PUBLIC_BASE_URL=             # e.g. https://your-tunnel.ngrok.app (dev) or prod domain
REQUEST_NODE_URL=https://main.gateway.request.network
REQUEST_CHAIN=polygon        # e.g. polygon, base, etc.
ERC20_TOKEN_ADDRESS=         # optional; if empty uses USDC symbol
BOT_TOKEN=                   # BotFather token for initData validation
ALLOW_UNVERIFIED_INITDATA=1  # dev bypass; omit in prod
PAYEE_ADDR=                  # your org/payee EVM address
FEE_ADDR=                    # optional; defaults to PAYEE_ADDR
NEXT_PUBLIC_PRIVY_APP_ID=    # Privy App ID
NEXT_PUBLIC_ONRAMP=COINBASE  # or MOONPAY
NEXT_PUBLIC_COINBASE_APP_ID= # Coinbase Onramp App ID (NOT API key)
COINBASE_DEFAULT_ASSET=USDC
COINBASE_DEFAULT_FIAT=USD
COINBASE_DEFAULT_FIAT_AMOUNT=20
# If your Coinbase Onramp app requires a session token, set this (temporary dev only):
# COINBASE_SESSION_TOKEN=    # server-generated session token per Coinbase docs
NEXT_PUBLIC_MOONPAY_KEY=     # MoonPay public key (if using MOONPAY)
MOONPAY_SECRET_KEY=          # MoonPay secret for URL signature
MOONPAY_DEFAULT_CURRENCY_CODE=usdc
MOONPAY_DEFAULT_BASE_CURRENCY=usd
```

### Dev setup
1) Install deps and run dev server
```bash
pnpm install
pnpm dev
```
2) Start a tunnel and set `PUBLIC_BASE_URL` to the HTTPS URL
```bash
npx ngrok http 3000
# or cloudflared tunnel --url http://localhost:3000
```
3) Set Telegram bot Web App URL to `PUBLIC_BASE_URL` with BotFather.

### API routes
- `/api/invoice` (POST)
  - Validates `initData` unless `ALLOW_UNVERIFIED_INITDATA=1` in non-prod
  - Creates Request invoice with ERC20 Fee Proxy on the configured chain/token
  - Responds `{ requestId, payUrl }` where `payUrl = PUBLIC_BASE_URL + /pay/[id]`

- `/api/status` (GET)
  - `?id=<requestId>` → rehydrates the request and returns `{ status: 'pending'|'paid', balance }`

- `/api/onramp/coinbase` (GET)
  - Redirects to Coinbase Hosted Onramp: `https://pay.coinbase.com/buy`
  - Params: `appId`, optional `addresses=[{address,blockchains:['base']}]`, `amount`, `fiatCurrency`, optional `assets` (USDC/ETH/...)
  - If your Onramp app enforces secure initialization, a `sessionToken` is required. Provide `COINBASE_SESSION_TOKEN` (dev) or implement a server endpoint to mint tokens per Coinbase [security requirements](https://docs.cdp.coinbase.com/onramp-&-offramp/security-requirements).

- `/api/onramp/moonpay` (GET)
  - Redirects to MoonPay `https://buy.moonpay.com` with a signed query
  - Requires `NEXT_PUBLIC_MOONPAY_KEY` and `MOONPAY_SECRET_KEY`

All API routes export `runtime = 'nodejs'` to avoid Edge limitations.

### Client behavior
- `app/page.tsx` dynamically imports `@twa-dev/sdk` in `useEffect`
- Privy `ensureWallet()` prompts login if not authenticated, then reads `wallets[0].address`
- POST to `/api/invoice` with `{ kind, amount:Number, note, initData, payee }`
- On success, opens `payUrl` inside Telegram webview

Funding (Add funds)
- Tries Privy `fundWallet` with `card.preferredProvider` from `NEXT_PUBLIC_ONRAMP`
- If the widget fails in Telegram IAB, we auto-fallback to an iframe overlay and an “Open in browser” button
- Known limitation: many onramps restrict flows inside Telegram’s webview; “Open in browser” is the reliable path

### cURL sanity
```bash
curl -X POST "$PUBLIC_BASE_URL/api/invoice" \
  -H "Content-Type: application/json" \
  -d '{"amount":1.23,"note":"Test","kind":"request","initData":"","payee":"0x..."}'

curl "$PUBLIC_BASE_URL/api/status?id=<requestId>"
```

### Production (Vercel)
- Set the same env vars (omit `ALLOW_UNVERIFIED_INITDATA`)
- Update BotFather Web App URL to the prod domain
- Test from phone; `/api/invoice` must validate Telegram `initData`

### WIP: Coinbase Onramp session token
- If you see a Coinbase page saying "Missing or invalid parameters: requires sessionToken" your Onramp app is configured to require secure initialization.
- For dev:
  - Option A: Temporarily disable session token requirement in the Coinbase portal
  - Option B: Provide `COINBASE_SESSION_TOKEN` (server-generated) and restart
- For prod:
  - Implement a backend endpoint to mint session tokens after authenticating the user (see Coinbase docs) and pass it through the `/api/onramp/coinbase` redirect.

### Domain whitelisting and bot linkage (Important for dev tunnels)
Many providers block unknown origins and IAB contexts. Any time your ngrok URL changes, update all allowlists:

- Privy (Allowed origins)
- Coinbase Onramp (Allowed origins / app settings)
- MoonPay (Allowed origins)
- Google OAuth (Authorized JavaScript origins and redirect URIs)
- Telegram (Bot Web App URL)

Recommended: Always use HTTPS ngrok domain (e.g., `https://dial.ngrok.app`). If the subdomain rotates, revisit each dashboard and re-add it.

#### Telegram bots ↔ domains (local vs prod)
All bots are owned by Adam. Current linkage:

- Dial Betabot → `https://dev.tgbot.dial.wtf` (development)
- Alpha Dialbot → `https://dial.ngrok.app` (local dev tunnel)
- Dial Official Bot → `https://tgbot.dial.wtf` (production)
- Dial WTF Bot → `https://tgbot.dial.wtf` (production)

Each bot has its own token and must be configured with the correct Web App URL and webhook.

#### Webhook and env sync
Use `scripts/sync-env-and-webhook.sh` to push env vars to Vercel and set the webhook for the current `.env.local`:

```bash
scripts/sync-env-and-webhook.sh development .env.local
# or preview/production
```

Env must include:
- `PUBLIC_BASE_URL` (matches the bot’s Web App URL)
- `BOT_TOKEN` (for the specific bot you’re linking)

This script sets the webhook to `${PUBLIC_BASE_URL}/api/bot` for the provided `BOT_TOKEN`.

