import React, { useState, useEffect, useMemo } from 'react';
import { Address } from 'viem';
import {
  Zap,
  Bell,
  Truck,
  Coins,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { useHyperliquidBbo } from './engine/hyperliquidWs';
import { usePapertradeOnChainFeed, OnChainPosition } from './engine/onchainFeed';
import {
  applyMarketImpact,
  computeBustPrice,
  computePositionPnl,
  estimateMintedPaperOnLoss,
} from './engine/papertradeMath';
import {
  DEFAULT_BUILDER_CODE_STATE,
  BuilderCodeConfig,
} from './config/builderCode';
import {
  StoredSessionKey,
  loadStoredSessionKey,
  createAndSignSessionKey,
  checkSessionKeyOnChain,
  clearLocalSessionKey,
} from './blockchain/sessionKeys';
import {
  SignedTradeIntent,
  connectEvmWallet,
  signPapertradeIntent,
  callOnChainHarvest,
  callOnChainPushStakerFees,
  callOnChainRequestSweep,
  callOnChainFinalizeSweep,
  callOnChainLiquidate,
  callOnChainRevokeSessionKey,
} from './blockchain/intentBuilder';
import {
  PixelTraderSprite,
  PixelBrinksTruck,
  PixelPrintingPress,
} from './components/PixelSprites';
import { LivePriceChart } from './components/LivePriceChart';

type FloorFilter = 'ALL' | 'PIT' | 'QUEUE' | 'PRESS' | 'ROOFTOP';

const shortAddr = (addr?: string | null) =>
  addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : 'Not Connected';

const fmtUsd = (val: number, digits = 2) =>
  val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const App: React.FC = () => {
  const [floorFilter, setFloorFilter] = useState<FloorFilter>('ALL');

  // Wallet & 1-Click Session Key
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [sessionKey, setSessionKey] = useState<StoredSessionKey | null>(null);

  // Live Feeds (Hyperliquid Candles + BBO WebSocket, HyperEVM Chain 999 Multicall)
  const bbo = useHyperliquidBbo();
  const { protocol, userState, refreshOnChain } =
    usePapertradeOnChainFeed(walletAddress);

  // Simple Trade Ticket State
  const [selectedCoin, setSelectedCoin] = useState<'BTC' | 'ETH'>('BTC');
  const [tradeSide, setTradeSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [marginInput, setMarginInput] = useState<string>('25');
  const [leverageInput, setLeverageInput] = useState<number>(250);
  const [spendQueued, setSpendQueued] = useState<boolean>(false);
  const [stakeAmountInput, setStakeAmountInput] = useState<string>('500');

  // Builder Code State
  const [builderConfig] = useState<BuilderCodeConfig>(
    DEFAULT_BUILDER_CODE_STATE
  );
  const [signedIntents, setSignedIntents] = useState<SignedTradeIntent[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>(
    'Live on HyperEVM (Chain 999) • Real-time BTC & ETH chart connected'
  );
  const [txBusy, setTxBusy] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setSessionKey(null);
      return;
    }
    const stored = loadStoredSessionKey(walletAddress);
    setSessionKey(stored);
    if (stored) {
      checkSessionKeyOnChain(walletAddress, stored.sessionKeyAddress);
    }
  }, [walletAddress]);

  const activeBbo = bbo[selectedCoin];
  const currentMid =
    activeBbo.mid > 0
      ? activeBbo.mid
      : selectedCoin === 'BTC'
      ? 84000
      : 1900;

  const numericMargin = Math.max(0, parseFloat(marginInput) || 0);
  const isLongSelected = tradeSide === 'LONG';

  // Trade Preview Math
  const preview = useMemo(() => {
    const impact = applyMarketImpact({
      midPrice: currentMid,
      marginUsd: numericMargin,
      leverage: leverageInput,
      isLong: isLongSelected,
      coin: selectedCoin,
    });
    const bustPrice = computeBustPrice(
      impact.effectiveEntryPrice,
      leverageInput,
      isLongSelected
    );
    const paperRewardOnLoss = estimateMintedPaperOnLoss(
      numericMargin,
      protocol.trackedLpUsd,
      protocol.tailProgressUsd
    );
    return {
      notionalUsd: numericMargin * leverageInput,
      entryPrice: impact.effectiveEntryPrice,
      impactBps: impact.impactBps,
      bustPrice,
      paperRewardOnLoss,
    };
  }, [
    currentMid,
    numericMargin,
    leverageInput,
    isLongSelected,
    selectedCoin,
    protocol.trackedLpUsd,
    protocol.tailProgressUsd,
  ]);

  const openPitPositions = useMemo(
    () => protocol.recentPositions.filter((p) => p.isOpen),
    [protocol.recentPositions]
  );
  const closedPitPositions = useMemo(
    () => protocol.recentPositions.filter((p) => !p.isOpen),
    [protocol.recentPositions]
  );

  // Actions
  const handleConnectWallet = async () => {
    try {
      setTxBusy(true);
      const addr = await connectEvmWallet();
      setWalletAddress(addr);
      setStatusMessage(`Connected wallet ${shortAddr(addr)} on HyperEVM`);
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Wallet connection cancelled'
      );
    } finally {
      setTxBusy(false);
    }
  };

  const handleToggleSessionKey = async () => {
    if (!walletAddress) {
      await handleConnectWallet();
      return;
    }
    if (sessionKey) {
      try {
        setTxBusy(true);
        await callOnChainRevokeSessionKey(
          walletAddress,
          sessionKey.sessionKeyAddress
        ).catch(() => null);
        clearLocalSessionKey(walletAddress);
        setSessionKey(null);
        setStatusMessage('1-Click Session Key disabled.');
      } finally {
        setTxBusy(false);
      }
      return;
    }
    try {
      setTxBusy(true);
      const created = await createAndSignSessionKey(walletAddress);
      setSessionKey(created);
      setStatusMessage('⚡ 1-Click Trading enabled for 30 days!');
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Could not sign Session Key'
      );
    } finally {
      setTxBusy(false);
    }
  };

  const handleExecuteTrade = async () => {
    let activeUser = walletAddress;
    if (!activeUser) {
      try {
        activeUser = await connectEvmWallet();
        setWalletAddress(activeUser);
      } catch {
        return;
      }
    }
    try {
      setTxBusy(true);
      const signed = await signPapertradeIntent({
        action: 'OPEN_POSITION',
        user: activeUser,
        sessionKey,
        builderConfig,
        instrumentId: selectedCoin === 'BTC' ? 0 : 1,
        coin: selectedCoin,
        isLong: isLongSelected,
        marginUsd: numericMargin,
        leverage: leverageInput,
        spendQueuedBalance: spendQueued,
      });
      setSignedIntents((prev) => [signed, ...prev.slice(0, 9)]);
      setStatusMessage(
        `✓ ${tradeSide} ${selectedCoin} ${leverageInput}x ($${numericMargin}) signed ${
          signed.signedWithSessionKey ? 'with 1-Click Key' : 'with Wallet'
        }!`
      );
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Trade signing cancelled'
      );
    } finally {
      setTxBusy(false);
    }
  };

  const handleStakingAction = async (
    action: 'STAKE_PAPER' | 'UNSTAKE_PAPER' | 'CLAIM_REWARDS'
  ) => {
    let activeUser = walletAddress;
    if (!activeUser) {
      try {
        activeUser = await connectEvmWallet();
        setWalletAddress(activeUser);
      } catch {
        return;
      }
    }
    try {
      setTxBusy(true);
      const signed = await signPapertradeIntent({
        action,
        user: activeUser,
        sessionKey,
        builderConfig,
        amountPaper: parseFloat(stakeAmountInput) || 0,
      });
      setSignedIntents((prev) => [signed, ...prev.slice(0, 9)]);
      setStatusMessage(`✓ ${action.replace('_', ' ')} intent signed!`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Action cancelled');
    } finally {
      setTxBusy(false);
    }
  };

  const handleHarvestQueue = async () => {
    let activeUser = walletAddress;
    if (!activeUser) {
      try {
        activeUser = await connectEvmWallet();
        setWalletAddress(activeUser);
      } catch {
        return;
      }
    }
    try {
      setTxBusy(true);
      setStatusMessage('Calling Exchange.harvest(32) on HyperEVM...');
      const tx = await callOnChainHarvest(activeUser, 32n);
      setStatusMessage(`Queue harvested! Tx: ${shortAddr(tx)}`);
      refreshOnChain();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Harvest failed');
    } finally {
      setTxBusy(false);
    }
  };

  const lpFillPct = Math.min(
    100,
    Math.max(5, (protocol.trackedLpUsd / 5_000_000) * 100)
  );

  const renderSimplePositionCard = (pos: OnChainPosition) => {
    const liveMark =
      pos.coin === 'BTC'
        ? bbo.BTC.mid || pos.entryPrice
        : bbo.ETH.mid || pos.entryPrice;
    const pnl = computePositionPnl({
      symbol: pos.coin,
      entryPrice: pos.entryPrice,
      currentMidPrice: liveMark,
      marginUsd: pos.marginUsd,
      leverage: pos.leverage,
      isLong: pos.isLong,
      trackedLpUsd: protocol.trackedLpUsd,
      tailProgressUsd: protocol.tailProgressUsd,
      queueIsEmpty: protocol.totalQueuedUsd === 0,
    });

    return (
      <div
        key={pos.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          background: '#0b1324',
          border: '1px solid #1e293b',
          borderLeft: `3px solid ${pos.isLong ? '#10b981' : '#f43f5e'}`,
          borderRadius: 6,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PixelTraderSprite
            seed={`${pos.user}-${pos.id}`}
            isLong={pos.isLong}
            isOpen={pos.isOpen}
            fromQueued={pos.fromQueued}
            size={26}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>
              {pos.coin} {pos.leverage}x{' '}
              <span style={{ color: pos.isLong ? '#34d399' : '#fb7185' }}>
                {pos.isLong ? 'LONG' : 'SHORT'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {shortAddr(pos.user)} • Entry ${fmtUsd(pos.entryPrice, 1)}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: pnl.netPnlUsd >= 0 ? '#34d399' : '#fb7185',
            }}
          >
            {pnl.netPnlUsd >= 0 ? '+' : ''}${fmtUsd(pnl.netPnlUsd, 2)} (
            {pnl.netRoePct.toFixed(0)}%)
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            ${fmtUsd(pos.marginUsd, 0)} margin
          </div>
          {pnl.isBust && (
            <button
              className="btn btn-red"
              style={{ padding: '2px 7px', fontSize: 10, marginTop: 3 }}
              onClick={() =>
                walletAddress &&
                callOnChainLiquidate(walletAddress, BigInt(pos.id))
              }
            >
              Liquidate
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* 1. CLEAN TOP BAR */}
      <header className="top-nav">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div className="brand-logo">
            <span>🏢 PAPERTRADE ARCADE</span>
          </div>

          {/* 1-Click BTC / ETH Switcher */}
          <div className="asset-switcher">
            <button
              className={`asset-tab ${selectedCoin === 'BTC' ? 'active' : ''}`}
              onClick={() => setSelectedCoin('BTC')}
            >
              <span style={{ color: '#f59e0b' }}>₿ BTC</span>
              <span>
                ${bbo.BTC.mid > 0 ? fmtUsd(bbo.BTC.mid, 1) : '...'}
              </span>
            </button>
            <button
              className={`asset-tab ${selectedCoin === 'ETH' ? 'active' : ''}`}
              onClick={() => setSelectedCoin('ETH')}
            >
              <span style={{ color: '#38bdf8' }}>Ξ ETH</span>
              <span>
                ${bbo.ETH.mid > 0 ? fmtUsd(bbo.ETH.mid, 2) : '...'}
              </span>
            </button>
          </div>
        </div>

        {/* Wallet & 1-Click Session Key Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{statusMessage}</span>

          <button
            className={`btn ${sessionKey ? 'btn-green' : ''}`}
            onClick={handleToggleSessionKey}
            disabled={txBusy}
            title="Enable 1-click trading for 30 days with zero wallet popups"
          >
            <Zap size={14} />
            {sessionKey ? '1-Click Mode: ON' : 'Enable 1-Click Mode'}
          </button>

          <button
            className={`btn ${walletAddress ? 'btn-green' : 'btn-gold'}`}
            onClick={handleConnectWallet}
            disabled={txBusy}
          >
            <KeyRound size={14} />
            {walletAddress ? shortAddr(walletAddress) : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* 2. SIMPLE 4-CARD PROTOCOL STATS BAR (PLAIN ENGLISH) */}
      <section className="stats-strip">
        <div className="stat-card">
          <span className="stat-card-label">💧 LP Vault Liquidity</span>
          <span className="stat-card-value" style={{ color: '#38bdf8' }}>
            ${fmtUsd(protocol.trackedLpUsd, 0)}
          </span>
          <span className="stat-card-sub">
            ${fmtUsd(protocol.lpBankrollAvailableUsd, 0)} liquid right now for
            instant payouts
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-label">🚶 Payout Queue Outside</span>
          <span
            className="stat-card-value"
            style={{
              color: protocol.totalQueuedUsd === 0 ? '#34d399' : '#facc15',
            }}
          >
            ${fmtUsd(protocol.totalQueuedUsd, 2)} Waiting
          </span>
          <span className="stat-card-sub">
            {protocol.totalQueuedUsd === 0
              ? 'Line is empty — Winning trades pay out immediately!'
              : `Queue Ticket #${protocol.queueHead} is next at the window`}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-label">🖨️ Loss-Mining Rebate</span>
          <span className="stat-card-value" style={{ color: '#34d399' }}>
            {protocol.marginalMintRate.toFixed(2)} $PAPER / $1
          </span>
          <span className="stat-card-sub">
            Minted automatically to you for every $1 lost in the pit
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-label">🍸 VIP Staked $PAPER</span>
          <span className="stat-card-value" style={{ color: '#facc15' }}>
            {(protocol.totalStakedPaper / 1e6).toFixed(2)}M PAPER
          </span>
          <span className="stat-card-sub">
            Earns 50% of protocol win fees in real USDC
          </span>
        </div>
      </section>

      {/* 3. MAIN 2-COLUMN WORKSPACE: LEFT (CHART + PIXEL TOWER), RIGHT (SIMPLE TRADE TICKET) */}
      <main className="workspace-grid">
        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* LIVE INTERACTIVE BTC / ETH CHART */}
          <LivePriceChart
            coin={selectedCoin}
            midPrice={currentMid}
            bid={activeBbo.bid || currentMid}
            ask={activeBbo.ask || currentMid}
            changePct={activeBbo.change24hPct}
            history={activeBbo.history}
            entryPrice={preview.entryPrice}
            bustPrice={preview.bustPrice}
            isLong={isLongSelected}
            leverage={leverageInput}
            interval={bbo.interval}
            onChangeInterval={bbo.setInterval}
          />

          {/* GAMIFIED PIXEL BUILDING: PAPERTRADE CENTRE */}
          <div className="card-surface" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                  🏢 Inside the Papertrade Centre (Live On-Chain View)
                </h2>
                <p style={{ fontSize: 12, color: '#94a3b8' }}>
                  Watch real traders on HyperEVM inside the Trading Pit, the
                  Payout Queue outside, and the $PAPER Printing Press.
                </p>
              </div>

              {/* Simple Filter Pills */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(
                  [
                    ['ALL', 'All Floors'],
                    ['PIT', '2F: Trading Pit'],
                    ['QUEUE', '1F: Payout Queue'],
                    ['PRESS', 'B1: $PAPER Press'],
                    ['ROOFTOP', '3F: VIP Staking'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`pill-btn ${floorFilter === key ? 'active' : ''}`}
                    onClick={() => setFloorFilter(key)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="pill-btn"
                  onClick={refreshOnChain}
                  title="Refresh on-chain state"
                >
                  <RefreshCw size={12} />
                </button>
              </div>
            </div>

            <div className="building-container">
              {/* FLOOR 3: VIP STAKERS ROOFTOP */}
              {(floorFilter === 'ALL' || floorFilter === 'ROOFTOP') && (
                <div
                  className="floor-section"
                  style={{
                    background:
                      'linear-gradient(180deg, #0d152a 0%, #111c36 100%)',
                  }}
                >
                  <div className="floor-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="floor-badge">3F • ROOFTOP</span>
                      <strong>🍸 VIP $PAPER Stakers&apos; Lounge</strong>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>
                        Stakers earn 1% of all winning trade volume in USDC
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>
                      USDC Pool Reserve: ${fmtUsd(protocol.rewardReserveUsd, 2)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <PixelTraderSprite seed="vip-1" isLong={true} size={30} />
                      <PixelTraderSprite
                        seed="vip-2"
                        isLong={true}
                        fromQueued={true}
                        size={30}
                      />
                      <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                        Your Staked: <strong>{fmtUsd(userState.stakedPaper, 1)} PAPER</strong> •
                        Claimable Yield:{' '}
                        <strong style={{ color: '#34d399' }}>
                          ${fmtUsd(userState.pendingRewardUsd, 4)} USDC
                        </strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        className="clean-input"
                        style={{ width: 110, fontSize: 13, padding: '6px 8px' }}
                        value={stakeAmountInput}
                        onChange={(e) => setStakeAmountInput(e.target.value)}
                        placeholder="PAPER"
                      />
                      <button
                        className="btn btn-green"
                        onClick={() => handleStakingAction('STAKE_PAPER')}
                        disabled={txBusy}
                      >
                        Stake
                      </button>
                      <button
                        className="btn"
                        onClick={() => handleStakingAction('UNSTAKE_PAPER')}
                        disabled={txBusy}
                      >
                        Unstake
                      </button>
                      <button
                        className="btn btn-gold"
                        onClick={() => handleStakingAction('CLAIM_REWARDS')}
                        disabled={txBusy}
                      >
                        Claim USDC
                      </button>
                      <button
                        className="btn"
                        onClick={() =>
                          walletAddress &&
                          callOnChainPushStakerFees(walletAddress)
                        }
                        disabled={txBusy}
                        title="Flush accumulated win fees into staking pool"
                      >
                        <Coins size={13} /> Flush Fees ($
                        {fmtUsd(protocol.stakerFeeAccumulatorUsd, 2)})
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* FLOOR 2: 1000x TRADING PIT & LP TANK */}
              {(floorFilter === 'ALL' || floorFilter === 'PIT') && (
                <div className="floor-section">
                  <div className="floor-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="floor-badge">2F • TRADING PIT</span>
                      <strong>⚡ Live 1000× Arena & LP Solvency Tank</strong>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>
                        Real-time on-chain positions on HyperEVM (#
                        {protocol.nextPositionId.toLocaleString()} total trades)
                      </span>
                    </div>

                    {/* Visual LP Tank Meter */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#38bdf8' }}>
                        LP Tank: ${(protocol.trackedLpUsd / 1e6).toFixed(2)}M /
                        $5.0M
                      </span>
                      <div
                        style={{
                          width: 90,
                          height: 10,
                          background: '#1e293b',
                          borderRadius: 5,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${lpFillPct}%`,
                            height: '100%',
                            background: '#38bdf8',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Two Simple Columns: Bull Elevator (Longs) & Bear Drill (Shorts) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#34d399',
                          marginBottom: 6,
                        }}
                      >
                        🟢 Bull Elevator (Active Longs)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {openPitPositions.filter((p) => p.isLong).length === 0 ? (
                          <div
                            style={{
                              padding: 12,
                              background: '#0b1324',
                              borderRadius: 6,
                              color: '#64748b',
                              fontSize: 12,
                            }}
                          >
                            No open Longs in the latest block sample.
                          </div>
                        ) : (
                          openPitPositions
                            .filter((p) => p.isLong)
                            .slice(0, 4)
                            .map(renderSimplePositionCard)
                        )}
                      </div>
                    </div>

                    <div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#fb7185',
                          marginBottom: 6,
                        }}
                      >
                        🔴 Bear Drill (Active Shorts)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {openPitPositions.filter((p) => !p.isLong).length ===
                        0 ? (
                          <div
                            style={{
                              padding: 12,
                              background: '#0b1324',
                              borderRadius: 6,
                              color: '#64748b',
                              fontSize: 12,
                            }}
                          >
                            No open Shorts in the latest block sample.
                          </div>
                        ) : (
                          openPitPositions
                            .filter((p) => !p.isLong)
                            .slice(0, 4)
                            .map(renderSimplePositionCard)
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* FLOOR 1: SIDEWALK FIFO PAYOUT QUEUE & BRINKS DEPOSIT TRUCK */}
              {(floorFilter === 'ALL' || floorFilter === 'QUEUE') && (
                <div
                  className="floor-section"
                  style={{ background: '#0c1424' }}
                >
                  <div className="floor-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="floor-badge">1F • SIDEWALK</span>
                      <strong>
                        🚶 Outside the Papertrade Centre: FIFO Payout Queue
                      </strong>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>
                        If the LP tank is busy, winning payouts line up here in
                        order
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="btn btn-gold"
                        onClick={handleHarvestQueue}
                        disabled={txBusy}
                        title="Calls Exchange.harvest(32) to pay out waiting traders"
                      >
                        <Bell size={13} /> Ring Cashier Bell (Harvest Queue)
                      </button>
                    </div>
                  </div>

                  {/* Visual Sidewalk Lineup */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      overflowX: 'auto',
                      padding: 10,
                      background: '#070b14',
                      borderRadius: 8,
                      border: '1px solid #1e293b',
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 12px',
                        background: '#422006',
                        border: '1px solid #facc15',
                        borderRadius: 6,
                        color: '#fef08a',
                        fontWeight: 700,
                        fontSize: 12,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🏦 CASHIER WINDOW
                    </div>

                    {protocol.activeQueueNodes.map((node) => {
                      const isWaiting =
                        node.id >= protocol.queueHead &&
                        protocol.totalQueuedUsd > 0;
                      return (
                        <div
                          key={node.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            background: '#0f172a',
                            border: '1px solid #334155',
                            borderRadius: 6,
                            minWidth: 165,
                          }}
                        >
                          <PixelTraderSprite
                            seed={`${node.user}-${node.id}`}
                            isLong={true}
                            fromQueued={true}
                            size={24}
                          />
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 700 }}>
                              Ticket #{node.id}{' '}
                              <span
                                style={{
                                  color: isWaiting ? '#facc15' : '#34d399',
                                }}
                              >
                                ({isWaiting ? 'Waiting' : 'Paid'})
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: '#f8fafc' }}>
                              ${fmtUsd(node.amountUsd, 2)} •{' '}
                              {shortAddr(node.user)}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    <div
                      style={{
                        marginLeft: 'auto',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        paddingLeft: 12,
                      }}
                    >
                      <PixelBrinksTruck />
                      {userState.computedProxyAddress && (
                        <div style={{ fontSize: 11 }}>
                          <div style={{ color: '#38bdf8', fontWeight: 600 }}>
                            Your Deposit Proxy:
                          </div>
                          <div style={{ color: '#94a3b8' }}>
                            {shortAddr(userState.computedProxyAddress)}
                          </div>
                          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <button
                              className="pill-btn"
                              onClick={() =>
                                walletAddress &&
                                callOnChainRequestSweep(
                                  walletAddress,
                                  walletAddress
                                )
                              }
                            >
                              <Truck size={11} /> Sweep
                            </button>
                            <button
                              className="pill-btn"
                              onClick={() =>
                                walletAddress &&
                                callOnChainFinalizeSweep(
                                  walletAddress,
                                  walletAddress
                                )
                              }
                            >
                              Finalize
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* BASEMENT B1: $PAPER PRINTING PRESS */}
              {(floorFilter === 'ALL' || floorFilter === 'PRESS') && (
                <div
                  className="floor-section"
                  style={{
                    background:
                      'linear-gradient(180deg, #100c1c 0%, #161026 100%)',
                  }}
                >
                  <div className="floor-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="floor-badge">B1 • BASEMENT</span>
                      <strong>🖨️ The $PAPER Printing Press (Loss Mining)</strong>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>
                        Every $1 lost in the pit automatically prints{' '}
                        <strong style={{ color: '#4ade80' }}>
                          {protocol.marginalMintRate.toFixed(2)} $PAPER
                        </strong>{' '}
                        for the trader
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>
                      Total Minted: {(protocol.paperTotalSupply / 1e6).toFixed(2)}M
                      / 100M PAPER
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      overflowX: 'auto',
                      padding: 10,
                      background: '#090612',
                      borderRadius: 8,
                      border: '1px dashed #22c55e',
                    }}
                  >
                    <PixelPrintingPress active={true} />

                    {closedPitPositions.slice(0, 6).map((pos) => {
                      const minted = pos.marginUsd * protocol.marginalMintRate;
                      return (
                        <div
                          key={pos.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 10px',
                            background: '#131022',
                            border: '1px solid #22c55e',
                            borderRadius: 6,
                            minWidth: 165,
                          }}
                        >
                          <PixelTraderSprite
                            seed={`${pos.user}-${pos.id}`}
                            isLong={pos.isLong}
                            isOpen={false}
                            size={24}
                          />
                          <div>
                            <div style={{ fontSize: 11, color: '#cbd5e1' }}>
                              #{pos.id} ({pos.coin} {pos.leverage}x)
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: '#4ade80',
                              }}
                            >
                              +{fmtUsd(minted, 1)} PAPER
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SIMPLE, EASY-TO-USE TRADE TICKET */}
        <aside className="trade-ticket">
          <div className="card-surface" style={{ padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                Place {selectedCoin}/USD Trade
              </h3>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: sessionKey
                    ? 'rgba(16, 185, 129, 0.15)'
                    : 'rgba(250, 204, 21, 0.15)',
                  color: sessionKey ? '#34d399' : '#facc15',
                  fontWeight: 600,
                }}
              >
                {sessionKey ? '⚡ 1-Click Active' : 'Wallet Sign'}
              </span>
            </div>

            {/* 1. LONG / SHORT TABS */}
            <div className="direction-tabs" style={{ marginBottom: 14 }}>
              <button
                className={`dir-tab long ${
                  tradeSide === 'LONG' ? 'active' : ''
                }`}
                onClick={() => setTradeSide('LONG')}
              >
                🟢 LONG (Buy)
              </button>
              <button
                className={`dir-tab short ${
                  tradeSide === 'SHORT' ? 'active' : ''
                }`}
                onClick={() => setTradeSide('SHORT')}
              >
                🔴 SHORT (Sell)
              </button>
            </div>

            {/* 2. COLLATERAL AMOUNT (USD) */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  color: '#94a3b8',
                  marginBottom: 6,
                }}
              >
                <span>Margin Amount (USD)</span>
                <span>
                  Balance: ${fmtUsd(userState.exchangeBalanceUsd, 2)}
                </span>
              </div>
              <input
                type="number"
                className="clean-input"
                value={marginInput}
                onChange={(e) => setMarginInput(e.target.value)}
                min="1"
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {['10', '25', '50', '100', '250'].map((amt) => (
                  <button
                    key={amt}
                    className={`pill-btn ${marginInput === amt ? 'active' : ''}`}
                    style={{ flex: 1 }}
                    onClick={() => setMarginInput(amt)}
                  >
                    ${amt}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. LEVERAGE SLIDER (20x - 1000x) */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                <span style={{ color: '#94a3b8' }}>Leverage</span>
                <strong style={{ color: '#facc15', fontSize: 15 }}>
                  {leverageInput}×
                </strong>
              </div>
              <input
                type="range"
                min={20}
                max={1000}
                step={10}
                value={leverageInput}
                onChange={(e) => setLeverageInput(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#38bdf8' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {[50, 100, 250, 500, 1000].map((lev) => (
                  <button
                    key={lev}
                    className={`pill-btn ${
                      leverageInput === lev ? 'active' : ''
                    }`}
                    style={{ flex: 1 }}
                    onClick={() => setLeverageInput(lev)}
                  >
                    {lev}×
                  </button>
                ))}
              </div>
            </div>

            {/* 4. PLAIN-ENGLISH TRADE SUMMARY */}
            <div className="summary-box" style={{ marginBottom: 12 }}>
              <div className="summary-line">
                <span>Total Position Size</span>
                <strong>${fmtUsd(preview.notionalUsd, 0)}</strong>
              </div>
              <div className="summary-line">
                <span>Estimated Entry Price</span>
                <strong>
                  ${fmtUsd(preview.entryPrice, selectedCoin === 'BTC' ? 1 : 2)}
                </strong>
              </div>
              <div className="summary-line">
                <span>Bust (Liquidation) Price</span>
                <strong style={{ color: '#fb7185' }}>
                  ${fmtUsd(preview.bustPrice, selectedCoin === 'BTC' ? 1 : 2)}
                </strong>
              </div>
              <div className="summary-line">
                <span>Win Fee (Only if Profitable)</span>
                <strong>2.0% of Profit</strong>
              </div>
              <div className="summary-line">
                <span>If Liquidated, You Receive</span>
                <strong style={{ color: '#34d399' }}>
                  +{fmtUsd(preview.paperRewardOnLoss, 1)} $PAPER
                </strong>
              </div>
            </div>

            {/* Spend Queued Balance Option */}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#cbd5e1',
                marginBottom: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={spendQueued}
                onChange={(e) => setSpendQueued(e.target.checked)}
              />
              <span>
                Use my Queued Payout Balance (${fmtUsd(userState.queuedAmountUsd, 2)})
              </span>
            </label>

            {/* 5. BIG ACTION BUTTON */}
            <button
              className={`btn ${
                tradeSide === 'LONG' ? 'btn-green' : 'btn-red'
              }`}
              style={{
                width: '100%',
                padding: '13px',
                fontSize: 15,
                fontWeight: 700,
              }}
              onClick={handleExecuteTrade}
              disabled={txBusy}
            >
              {tradeSide === 'LONG' ? '🟢 BUY / LONG' : '🔴 SELL / SHORT'}{' '}
              {selectedCoin} ({leverageInput}×)
            </button>
          </div>

          {/* USER WALLET & BUILDER CODE DRAWER */}
          <div className="card-surface" style={{ padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Your Account Summary
            </div>
            <div className="summary-box">
              <div className="summary-line">
                <span>Exchange USD Balance</span>
                <strong>${fmtUsd(userState.exchangeBalanceUsd, 2)}</strong>
              </div>
              <div className="summary-line">
                <span>Queued Payouts</span>
                <strong style={{ color: '#facc15' }}>
                  ${fmtUsd(userState.queuedAmountUsd, 2)}
                </strong>
              </div>
              <div className="summary-line">
                <span>$PAPER Token Balance</span>
                <strong style={{ color: '#34d399' }}>
                  {fmtUsd(userState.paperBalance, 2)} PAPER
                </strong>
              </div>
              <div className="summary-line">
                <span>Open Positions</span>
                <strong>{userState.openPositions.length}</strong>
              </div>
            </div>

            {/* Collapsible Builder Code & Signed Payload Inspector */}
            <details style={{ marginTop: 12, fontSize: 12, color: '#94a3b8' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontWeight: 600,
                  color: '#cbd5e1',
                }}
              >
                <span>
                  Builder Code Attribution ({builderConfig.builderCode})
                </span>
                <ChevronDown size={14} />
              </summary>
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 11, marginBottom: 6 }}>
                  Every signed trade automatically tags{' '}
                  <code style={{ color: '#38bdf8' }}>
                    {builderConfig.builderCode}
                  </code>{' '}
                  (1% LP fee share, 0 extra cost to user).
                </p>
                {signedIntents.length > 0 && (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 4,
                      }}
                    >
                      <span>Latest Signed Payload:</span>
                      <button
                        className="pill-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            signedIntents[0].typedDataJson
                          );
                          setCopiedId(signedIntents[0].id);
                          setTimeout(() => setCopiedId(null), 1500);
                        }}
                      >
                        {copiedId === signedIntents[0].id ? (
                          <>
                            <Check size={10} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={10} /> Copy JSON
                          </>
                        )}
                      </button>
                    </div>
                    <pre
                      style={{
                        background: '#050811',
                        padding: 8,
                        borderRadius: 6,
                        fontSize: 11,
                        color: '#a7f3d0',
                        maxHeight: 150,
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {signedIntents[0].typedDataJson}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          </div>
        </aside>
      </main>
    </div>
  );
};
