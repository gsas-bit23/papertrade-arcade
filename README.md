# 🏢 Papertrade Arcade

A gamified, pixel-art trading frontend for **[Papertrade](https://papertrade.xyz)** on **HyperEVM Mainnet (Chain ID 999)**, featuring live Hyperliquid BBO WebSocket price feeds, an interactive multi-floor Papertrade Centre visualization, 30-day 1-click Session Key signing, and a Phase 3 **Builder Code (`builderCode`)** attribution adapter.

## ✨ Features

- **Live BTC/USD & ETH/USD Price Chart**: Streams real-time BBO midpoint ticks (`wss://api.hyperliquid.xyz/ws`) and historical candles (`1m`, `5m`, `15m`) from Hyperliquid, with live Entry Price and 5 bps Hard-Liquidation Bust Line overlays.
- **Interactive Papertrade Centre Building**:
  - **3F — VIP `$PAPER` Stakers' Rooftop (`PaperStaking`)**: View staked `$PAPER`, claimable USDC rewards, and flush accumulated staker fees (`Exchange.pushStakerFees()`).
  - **2F — 1000× Trading Pit & LP Solvency Tank (`Exchange`)**: Watch real-time on-chain Longs (Bull Elevator) and Shorts (Bear Drill) on HyperEVM alongside the Glass LP Solvency Tank (`$2.0M` flat threshold / `$5.0M` overflow cap).
  - **1F — Sidewalk FIFO Payout Queue & Armored Brinks Truck (`QueueLib` & `DepositProxyFactory`)**: Inspect queue tickets, trigger permissionless `Exchange.harvest(32)` calls, spend queued balances directly, and sweep deterministic `CREATE2` deposit proxies.
  - **B1 — The `$PAPER` Printing Press (`PaperTokenomics`)**: Live loss-mining bonding curve telemetry $R(S, H) = 100 \cdot \left(\frac{S}{S + H}\right)^2$ and recent closed/liquidated positions.
- **1-Click Session Key Mode (`SessionKeyManager`)**: Mint a 30-day ephemeral session key via EIP-712 so subsequent trades sign with zero wallet popups.
- **Builder Code Adapter**: Automatically attaches `builderCode` attribution (`100 bps` LP fee share, zero extra fee to traders) to every signed trade intent.

## 🚀 Getting Started

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```
