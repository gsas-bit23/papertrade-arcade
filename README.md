# Papertrade Arcade

An experimental React dashboard for Papertrade on HyperEVM (chain 999), with BTC/ETH market feeds, position previews, account balances, queue inspection, and staking views.

**Trading and staking submissions are disabled by default.** A compatible, browser-accessible Papertrade relayer endpoint and successful integration validation are required. Protocol authorization of the relayer does not establish a separate approval requirement for frontends. This repository does not contain a relayer. See [integration requirements](docs/INTEGRATION.md) and [audit results](docs/AUDIT.md).

## Development

Requires Node.js 24 and npm.

```sh
npm ci
npm test
npm run build
npm run dev
```

Copy `.env.example` to `.env.local` only when configuring a verified integration. All `VITE_` variables are public; never put keys or secrets in them.

The dashboard reads HyperEVM RPC and Hyperliquid WebSocket/candle endpoints. Network or contract read failures disable affected actions. Quotes older than 10 seconds and account snapshots older than 15 seconds cannot authorize new trades.

## Wallet behavior

Trading session keys stay in tab memory; only public revocation metadata persists. Reloading requires a new session or owner signing. Previously stored plaintext keys are removed on account metadata migration, retaining their addresses for revocation. Revoke old sessions before authorizing replacements. Staking always uses the owner wallet.

Wallet account/network changes clear active authorization. Transaction receipts must indicate success. Signed requests are submitted once, with persistent unresolved-request protection and cross-tab locking. A queued request is not a confirmed trade. After ambiguous results, inspect official account activity before manually clearing the pending guard; clearing it does not cancel a signed request.

Price, PnL, liquidation, and PAPER previews are estimates using documented launch parameters, not authoritative settlement results. Closed-position settlement is not indexed. Builder attribution is disabled because the integration is not live. Use the official application for deposits and production trading until the integration requirements are complete.

## Request outcome tracking

Connected wallets subscribe to the public wallet SSE endpoint, with no cookies. Reported outcomes persist across reloads and are shown separately from submission acknowledgements. `VITE_STATUS_URL` can override the status service; it must describe the same chain/deployment as the relayer. A reported success is not an independently verified transaction receipt, so unresolved requests remain guarded until explicitly reconciled. Missed outcomes are not reconstructed from a later snapshot.

Run `npm run verify:public-api -- https://your-frontend.example` to probe public reads and POST preflight from an origin (requires curl). This sends only GET and OPTIONS, never signed requests. The current localhost POST preflight fails; the public read stream works.
