# Papertrade Arcade

An experimental React dashboard for Papertrade on HyperEVM (chain 999), with BTC/ETH market feeds, position previews, account balances, queue inspection, and staking views.

**Trading and staking submissions are disabled by default.** An approved, browser-accessible Papertrade relayer is required. This repository does not contain an authorized relayer. Do not configure the official website as a relayer without protocol approval and successful integration validation. See [integration requirements](docs/INTEGRATION.md) and [audit results](docs/AUDIT.md).

## Development

Requires Node.js 24 and npm.

```sh
npm ci
npm test
npm run build
npm run dev
```

Copy `.env.example` to `.env.local` only when configuring an approved integration. All `VITE_` variables are public; never put keys or secrets in them.

The dashboard reads HyperEVM RPC and Hyperliquid WebSocket/candle endpoints. Network or contract read failures disable affected actions. Quotes older than 10 seconds and account snapshots older than 15 seconds cannot authorize new trades.

## Wallet behavior

Trading session keys stay in tab memory; only public revocation metadata persists. Reloading requires a new session or owner signing. Previously stored plaintext keys are removed on account metadata migration, retaining their addresses for revocation. Revoke old sessions before authorizing replacements. Staking always uses the owner wallet.

Wallet account/network changes clear active authorization. Transaction receipts must indicate success. Signed requests are submitted once, with persistent unresolved-request protection and cross-tab locking. A queued request is not a confirmed trade. After ambiguous results, inspect official account activity before manually clearing the pending guard; clearing it does not cancel a signed request.

Price, PnL, liquidation, and PAPER previews are estimates using documented launch parameters, not authoritative settlement results. Closed-position settlement is not indexed. Builder attribution is disabled because the integration is not live. Use the official application for deposits and production trading until the integration requirements are complete.
