/**
 * Exact Papertrade protocol math from docs.papertrade.xyz:
 * - BBO Midpoint pricing
 * - 0.2 bps deadband on winning closes
 * - Asymmetric Impact PnL scale factor (QueueLib.applyMarketImpact)
 * - 2% win fee
 * - ~5 bps hard-liquidation bust price buffer
 * - PaperTokenomics flat-then-ratchet $PAPER mint curve
 */

export type AssetSymbol = 'BTC' | 'ETH';

export interface InstrumentParams {
  id: number;
  symbol: AssetSymbol;
  baseRate: number; // 0.10 (10%)
  rateMultiplier: number; // 15,000
  referenceNotional: number; // $100,000
  positionMultiplier: number; // 814.598 for BTC, 483.979 for ETH
  priceDecimalsOnChain: number; // On-chain entryPrice is stored as price * 10
}

export const INSTRUMENTS: Record<AssetSymbol, InstrumentParams> = {
  BTC: {
    id: 0,
    symbol: 'BTC',
    baseRate: 0.1,
    rateMultiplier: 15000,
    referenceNotional: 100000,
    positionMultiplier: 814.598,
    priceDecimalsOnChain: 10,
  },
  ETH: {
    id: 1,
    symbol: 'ETH',
    baseRate: 0.1,
    rateMultiplier: 15000,
    referenceNotional: 100000,
    positionMultiplier: 483.979,
    priceDecimalsOnChain: 10,
  },
};

export interface PnlBreakdown {
  rawPnlUsd: number;
  rawRoePct: number;
  afterDeadbandPnlUsd: number;
  impactScale: number;
  scaledPnlUsd: number;
  winFeeUsd: number;
  netPnlUsd: number;
  netRoePct: number;
  bustPrice: number;
  distanceToBustBps: number;
  estimatedPaperMintOnLoss: number;
  isBust: boolean;
}

/**
 * Computes hard-liquidation bust price (~5 bps buffer before 0-equity).
 * At 1000x leverage (10 bps full margin), the 5 bps buffer means bust triggers around ~5.2 bps adverse move.
 */
export function computeBustPrice(entryPrice: number, leverage: number, isLong: boolean): number {
  if (entryPrice <= 0 || leverage <= 0) return 0;
  const fullMarginMove = 1 / leverage;
  const buffer = 0.0005; // 5 bps fixed buffer
  const bustMove = Math.max(0.00048, fullMarginMove - buffer);
  return isLong ? entryPrice * (1 - bustMove) : entryPrice * (1 + bustMove);
}

/**
 * Computes the marginal $PAPER mint rate per $1 of eligible loss basis:
 * - Flat region (trackedLpUsd < $2M, including underwater): 100 PAPER / $1
 * - Tail region (trackedLpUsd >= $2M): 100 * (S / (S + H))^2 where S = $120M, H = tailProgressUsd
 */
export function computeMarginalMintRate(
  trackedLpUsd: number,
  tailProgressUsd: number,
  flatThresholdUsd = 2_000_000,
  tailDecayScaleUsd = 120_000_000,
  flatRate = 100
): number {
  if (trackedLpUsd < flatThresholdUsd) {
    return flatRate;
  }
  const ratio = tailDecayScaleUsd / (tailDecayScaleUsd + Math.max(0, tailProgressUsd));
  return flatRate * ratio * ratio;
}

/**
 * Full PnL breakdown matching QueueLib.applyMarketImpact & Exchange close accounting.
 */
export function computePositionPnl(params: {
  symbol: AssetSymbol;
  entryPrice: number;
  currentMidPrice: number;
  marginUsd: number;
  leverage: number;
  isLong: boolean;
  trackedLpUsd: number;
  tailProgressUsd: number;
  queueIsEmpty: boolean;
}): PnlBreakdown {
  const {
    symbol,
    entryPrice,
    currentMidPrice,
    marginUsd,
    leverage,
    isLong,
    trackedLpUsd,
    tailProgressUsd,
    queueIsEmpty,
  } = params;

  const inst = INSTRUMENTS[symbol];
  const notionalUsd = marginUsd * leverage;
  const bustPrice = computeBustPrice(entryPrice, leverage, isLong);

  const signedMove =
    entryPrice > 0
      ? isLong
        ? (currentMidPrice - entryPrice) / entryPrice
        : (entryPrice - currentMidPrice) / entryPrice
      : 0;

  const isBust =
    entryPrice > 0 &&
    ((isLong && currentMidPrice <= bustPrice) || (!isLong && currentMidPrice >= bustPrice));

  const distanceToBustBps =
    currentMidPrice > 0
      ? Math.max(
          0,
          ((isLong ? currentMidPrice - bustPrice : bustPrice - currentMidPrice) / currentMidPrice) *
            10000
        )
      : 0;

  const rawPnlUsd = notionalUsd * signedMove;
  const rawRoePct = marginUsd > 0 ? (rawPnlUsd / marginUsd) * 100 : 0;

  const mintRate = computeMarginalMintRate(trackedLpUsd, tailProgressUsd);

  // Hard bust forfeits 100% of isolated margin and mints PAPER on full lost margin
  if (isBust) {
    return {
      rawPnlUsd: -marginUsd,
      rawRoePct: -100,
      afterDeadbandPnlUsd: -marginUsd,
      impactScale: 1,
      scaledPnlUsd: -marginUsd,
      winFeeUsd: 0,
      netPnlUsd: -marginUsd,
      netRoePct: -100,
      bustPrice,
      distanceToBustBps: 0,
      estimatedPaperMintOnLoss: marginUsd * mintRate,
      isBust: true,
    };
  }

  // Losing close: no haircut, no extra fee on trader; mints PAPER on eligible loss basis
  if (signedMove <= 0) {
    const cappedLoss = Math.min(marginUsd, Math.abs(rawPnlUsd));
    // When queue is empty, 2% LP-side fee is carved from LP's gain so mint basis is 98% of rawLoss; when queue is active, 100%
    const eligibleBasis = queueIsEmpty ? cappedLoss * 0.98 : cappedLoss;
    return {
      rawPnlUsd: -cappedLoss,
      rawRoePct: marginUsd > 0 ? (-cappedLoss / marginUsd) * 100 : 0,
      afterDeadbandPnlUsd: -cappedLoss,
      impactScale: 1,
      scaledPnlUsd: -cappedLoss,
      winFeeUsd: 0,
      netPnlUsd: -cappedLoss,
      netRoePct: marginUsd > 0 ? (-cappedLoss / marginUsd) * 100 : 0,
      bustPrice,
      distanceToBustBps,
      estimatedPaperMintOnLoss: eligibleBasis * mintRate,
      isBust: false,
    };
  }

  // Winning close:
  // Step 1: 0.2 bps jitter-protection deadband (entryPrice / 50000)
  const deadbandMove = 1 / 50000; // 0.00002 = 0.2 bps
  const moveAfterDeadband = Math.max(0, signedMove - deadbandMove);

  if (moveAfterDeadband <= 0) {
    return {
      rawPnlUsd,
      rawRoePct,
      afterDeadbandPnlUsd: 0,
      impactScale: 0,
      scaledPnlUsd: 0,
      winFeeUsd: 0,
      netPnlUsd: 0,
      netRoePct: 0,
      bustPrice,
      distanceToBustBps,
      estimatedPaperMintOnLoss: 0,
      isBust: false,
    };
  }

  const afterDeadbandPnlUsd = notionalUsd * moveAfterDeadband;

  // Step 2: Asymmetric impact scale factor
  const term1 = 1 / (moveAfterDeadband * inst.rateMultiplier);
  const term2 =
    inst.referenceNotional / (1_000_000 * moveAfterDeadband * inst.positionMultiplier);
  const impactScale = (1 - inst.baseRate) / (1 + term1 + term2);

  const scaledPnlUsd = afterDeadbandPnlUsd * impactScale;

  // Step 3: 2% win fee
  const winFeeUsd = scaledPnlUsd * 0.02;
  const netPnlUsd = scaledPnlUsd - winFeeUsd;
  const netRoePct = marginUsd > 0 ? (netPnlUsd / marginUsd) * 100 : 0;

  return {
    rawPnlUsd,
    rawRoePct,
    afterDeadbandPnlUsd,
    impactScale,
    scaledPnlUsd,
    winFeeUsd,
    netPnlUsd,
    netRoePct,
    bustPrice,
    distanceToBustBps,
    estimatedPaperMintOnLoss: 0,
    isBust: false,
  };
}

/**
 * Computes BBO midpoint and checks whether price move since previous mid is inside 0.2 bps deadband.
 */
export function computeBboMid(
  bid: number,
  ask: number,
  prevMid?: number
): { mid: number; spreadBps: number; inDeadband: boolean } {
  const mid = (bid + ask) / 2;
  const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : 0;
  const moveBps =
    prevMid && prevMid > 0 ? (Math.abs(mid - prevMid) / prevMid) * 10000 : 0;
  return {
    mid,
    spreadBps,
    inDeadband: moveBps < 0.2,
  };
}

/**
 * Computes asymmetric impact preview for opening/closing a position at given notional.
 */
export function applyMarketImpact(params: {
  midPrice: number;
  marginUsd: number;
  leverage: number;
  isLong: boolean;
  coin: AssetSymbol;
}): { effectiveEntryPrice: number; impactBps: number; notionalUsd: number } {
  const { midPrice, marginUsd, leverage, isLong, coin } = params;
  const inst = INSTRUMENTS[coin];
  const notionalUsd = marginUsd * leverage;
  const deadbandBps = 0.2; // 0.2 bps jitter deadband
  const sizeImpactBps =
    (notionalUsd / inst.referenceNotional) * (1000 / inst.positionMultiplier);
  const impactBps = deadbandBps + sizeImpactBps;
  const impactFraction = impactBps / 10000;
  const effectiveEntryPrice = isLong
    ? midPrice * (1 + impactFraction)
    : midPrice * (1 - impactFraction);
  return {
    effectiveEntryPrice,
    impactBps,
    notionalUsd,
  };
}

/**
 * Estimates $PAPER minted if a position of `lossUsd` is busted at current curve state.
 */
export function estimateMintedPaperOnLoss(
  lossUsd: number,
  trackedLpUsd: number,
  tailProgressUsd: number
): number {
  const rate = computeMarginalMintRate(trackedLpUsd, tailProgressUsd);
  return Math.max(0, lossUsd) * rate;
}

