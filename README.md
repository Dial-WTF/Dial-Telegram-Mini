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

All API routes export `runtime = 'nodejs'` to avoid Edge limitations.

### Client behavior
- `app/page.tsx` dynamically imports `@twa-dev/sdk` in `useEffect`
- Privy `ensureWallet()` prompts login if not authenticated, then reads `wallets[0].address`
- POST to `/api/invoice` with `{ kind, amount:Number, note, initData, payee }`
- On success, opens `payUrl` inside Telegram webview

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
