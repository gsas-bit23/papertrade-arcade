import { useEffect, useState, useCallback } from 'react';
import { Address, formatUnits } from 'viem';
import { publicClient } from '../config/chain';
import {
  PAPERTRADE_CONTRACTS,
  EXCHANGE_ABI,
  PAPER_TOKENOMICS_ABI,
  PAPER_TOKEN_ABI,
  PAPER_STAKING_ABI,
  DEPOSIT_PROXY_FACTORY_ABI,
  ERC20_ABI,
} from '../config/contracts';
import { computeMarginalMintRate } from './papertradeMath';

export interface OnChainPosition {
  id: number;
  user: Address;
  instrumentId: number; // 0 = BTC, 1 = ETH
  coin: 'BTC' | 'ETH';
  entryPrice: number; // scaled from uint64 (price / 10)
  marginUsd: number;
  leverage: number;
  openedAt: number;
  isLong: boolean;
  fromQueued: boolean;
  isOpen: boolean;
}

export interface OnChainQueueNode {
  id: number;
  user: Address;
  amountUsd: number;
  next: number;
  userNext: number;
}

export interface ProtocolOnChainState {
  blockNumber: bigint;
  treasuryUsd: number;
  totalBalancesUsd: number;
  totalLockedMarginUsd: number;
  lpBankrollAvailableUsd: number;
  sideBucketUsd: number;
  totalQueuedUsd: number;
  queueHead: number;
  queueTail: number;
  nextPositionId: number;
  stakerFeeAccumulatorUsd: number;
  trackedLpUsd: number;
  tailProgressUsd: number;
  paperTotalSupply: number;
  totalStakedPaper: number;
  rewardReserveUsd: number;
  accRewardPerShare: bigint;
  marginalMintRate: number;
  recentPositions: OnChainPosition[];
  activeQueueNodes: OnChainQueueNode[];
  paused: boolean;
  loading: boolean;
  error: string | null;
  lastUpdatedMs: number;
}

export interface UserOnChainState {
  address: Address | null;
  exchangeBalanceUsd: number;
  queuedAmountUsd: number;
  userQueueHead: number;
  walletUsdcBalance: number;
  paperBalance: number;
  stakedPaper: number;
  pendingRewardUsd: number;
  openPositionIds: number[];
  openPositions: OnChainPosition[];
  computedProxyAddress: Address | null;
  deployedProxyAddress: Address | null;
  proxyUsdcBalance: number;
}

const toUsd18 = (val: unknown): number => {
  if (typeof val !== 'bigint') return 0;
  return parseFloat(formatUnits(val, 18));
};

const toUsdc6 = (val: unknown): number => {
  if (typeof val !== 'bigint') return 0;
  return parseFloat(formatUnits(val, 6));
};

export function usePapertradeOnChainFeed(userAddress: Address | null) {
  const [protocol, setProtocol] = useState<ProtocolOnChainState>({
    blockNumber: 0n,
    treasuryUsd: 0,
    totalBalancesUsd: 0,
    totalLockedMarginUsd: 0,
    lpBankrollAvailableUsd: 0,
    sideBucketUsd: 0,
    totalQueuedUsd: 0,
    queueHead: 1,
    queueTail: 0,
    nextPositionId: 0,
    stakerFeeAccumulatorUsd: 0,
    trackedLpUsd: 0,
    tailProgressUsd: 0,
    paperTotalSupply: 0,
    totalStakedPaper: 0,
    rewardReserveUsd: 0,
    accRewardPerShare: 0n,
    marginalMintRate: 100,
    recentPositions: [],
    activeQueueNodes: [],
    paused: false,
    loading: true,
    error: null,
    lastUpdatedMs: 0,
  });

  const [userState, setUserState] = useState<UserOnChainState>({
    address: null,
    exchangeBalanceUsd: 0,
    queuedAmountUsd: 0,
    userQueueHead: 0,
    walletUsdcBalance: 0,
    paperBalance: 0,
    stakedPaper: 0,
    pendingRewardUsd: 0,
    openPositionIds: [],
    openPositions: [],
    computedProxyAddress: null,
    deployedProxyAddress: null,
    proxyUsdcBalance: 0,
  });

  const parsePositionTuple = (id: number, raw: unknown): OnChainPosition | null => {
    if (!Array.isArray(raw) || raw.length < 9) return null;
    const [
      user,
      instrumentId,
      entryPriceRaw,
      marginRaw,
      leverage,
      openedAtRaw,
      isLong,
      fromQueued,
      isOpen,
    ] = raw;
    if (!user || user === '0x0000000000000000000000000000000000000000') return null;
    const instNum = Number(instrumentId);
    return {
      id,
      user: user as Address,
      instrumentId: instNum,
      coin: instNum === 1 ? 'ETH' : 'BTC',
      entryPrice: Number(entryPriceRaw) / 10,
      marginUsd: toUsd18(marginRaw),
      leverage: Number(leverage),
      openedAt: Number(openedAtRaw),
      isLong: Boolean(isLong),
      fromQueued: Boolean(fromQueued),
      isOpen: Boolean(isOpen),
    };
  };

  const fetchAll = useCallback(async () => {
    try {
      const ex = PAPERTRADE_CONTRACTS.Exchange;
      const tok = PAPERTRADE_CONTRACTS.PaperTokenomics;
      const pap = PAPERTRADE_CONTRACTS.PaperToken;
      const stk = PAPERTRADE_CONTRACTS.PaperStaking;

      const [blockNumber, coreResults] = await Promise.all([
        publicClient.getBlockNumber(),
        publicClient.multicall({
          contracts: [
            { address: ex, abi: EXCHANGE_ABI, functionName: 'treasury' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'totalBalances' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'totalLockedMargin' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'lpBankrollAvailable' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'sideBucket' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'totalQueued' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'queueHead' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'nextPositionId' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'stakerFeeAccumulator' },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'tradingPaused' },
            { address: tok, abi: PAPER_TOKENOMICS_ABI, functionName: 'trackedLpUsd' },
            { address: tok, abi: PAPER_TOKENOMICS_ABI, functionName: 'tailProgressUsd' },
            { address: pap, abi: PAPER_TOKEN_ABI, functionName: 'totalSupply' },
            { address: stk, abi: PAPER_STAKING_ABI, functionName: 'totalStaked' },
            { address: stk, abi: PAPER_STAKING_ABI, functionName: 'rewardReserve' },
            { address: stk, abi: PAPER_STAKING_ABI, functionName: 'accRewardPerShare' },
          ],
          allowFailure: true,
        }),
      ]);

      const qHead = Number(coreResults[6]?.result ?? 1n);
      const nextPosId = Number(coreResults[7]?.result ?? 0n);

      // Fetch the 14 most recent on-chain positions to animate the Trading Pit & Basement Press
      const sampleCount = 14;
      const posIdsToQuery: number[] = [];
      for (let i = 1; i <= sampleCount; i++) {
        if (nextPosId - i > 0) posIdsToQuery.push(nextPosId - i);
      }

      // Fetch queue nodes around queueHead (last 4 resolved + next 4 in line)
      const queueIdsToQuery: number[] = [];
      const startQ = Math.max(1, qHead - 4);
      for (let q = startQ; q <= qHead + 3; q++) {
        queueIdsToQuery.push(q);
      }

      const secondaryContracts = [
        ...posIdsToQuery.map((id) => ({
          address: ex,
          abi: EXCHANGE_ABI,
          functionName: 'positions' as const,
          args: [BigInt(id)] as const,
        })),
        ...queueIdsToQuery.map((qId) => ({
          address: ex,
          abi: EXCHANGE_ABI,
          functionName: 'queueNode' as const,
          args: [BigInt(qId)] as const,
        })),
      ];

      const secondaryResults =
        secondaryContracts.length > 0
          ? await publicClient.multicall({
              contracts: secondaryContracts,
              allowFailure: true,
            })
          : [];

      const recentPositions: OnChainPosition[] = [];
      for (let i = 0; i < posIdsToQuery.length; i++) {
        const res = secondaryResults[i];
        if (res?.status === 'success') {
          const parsed = parsePositionTuple(posIdsToQuery[i], res.result);
          if (parsed) recentPositions.push(parsed);
        }
      }

      const activeQueueNodes: OnChainQueueNode[] = [];
      for (let j = 0; j < queueIdsToQuery.length; j++) {
        const res = secondaryResults[posIdsToQuery.length + j];
        if (res?.status === 'success' && Array.isArray(res.result)) {
          const [uAddr, amtRaw, nextId, userNextId] = res.result;
          if (uAddr && uAddr !== '0x0000000000000000000000000000000000000000') {
            activeQueueNodes.push({
              id: queueIdsToQuery[j],
              user: uAddr as Address,
              amountUsd: toUsd18(amtRaw),
              next: Number(nextId),
              userNext: Number(userNextId),
            });
          }
        }
      }

      const trackedLpUsd = toUsd18(coreResults[10]?.result);
      const tailProgressUsd = toUsd18(coreResults[11]?.result);
      const paperTotalSupply = toUsd18(coreResults[12]?.result);
      const totalQueuedUsd = toUsd18(coreResults[5]?.result);
      const qTail =
        activeQueueNodes.length > 0
          ? activeQueueNodes[activeQueueNodes.length - 1].id
          : qHead - 1;

      setProtocol({
        blockNumber,
        treasuryUsd: toUsd18(coreResults[0]?.result),
        totalBalancesUsd: toUsd18(coreResults[1]?.result),
        totalLockedMarginUsd: toUsd18(coreResults[2]?.result),
        lpBankrollAvailableUsd: toUsd18(coreResults[3]?.result),
        sideBucketUsd: toUsd18(coreResults[4]?.result),
        totalQueuedUsd,
        queueHead: qHead,
        queueTail: qTail,
        nextPositionId: nextPosId,
        stakerFeeAccumulatorUsd: toUsd18(coreResults[8]?.result),
        paused: Boolean(coreResults[9]?.result),
        trackedLpUsd,
        tailProgressUsd,
        paperTotalSupply,
        totalStakedPaper: toUsd18(coreResults[13]?.result),
        rewardReserveUsd: toUsd18(coreResults[14]?.result),
        accRewardPerShare: (coreResults[15]?.result as bigint) ?? 0n,
        marginalMintRate: computeMarginalMintRate(trackedLpUsd, tailProgressUsd),
        recentPositions,
        activeQueueNodes,
        loading: false,
        error: null,
        lastUpdatedMs: Date.now(),
      });

      // If user wallet is connected, fetch their personal on-chain state
      if (userAddress) {
        const dpf = PAPERTRADE_CONTRACTS.DepositProxyFactory;
        const usdc = PAPERTRADE_CONTRACTS.USDC;

        const userCalls = await publicClient.multicall({
          contracts: [
            { address: ex, abi: EXCHANGE_ABI, functionName: 'balances', args: [userAddress] },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'userQueueHead', args: [userAddress] },
            { address: ex, abi: EXCHANGE_ABI, functionName: 'getUserOpenPositionIds', args: [userAddress] },
            { address: usdc, abi: ERC20_ABI, functionName: 'balanceOf', args: [userAddress] },
            { address: pap, abi: PAPER_TOKEN_ABI, functionName: 'balanceOf', args: [userAddress] },
            { address: stk, abi: PAPER_STAKING_ABI, functionName: 'stakedBalance', args: [userAddress] },
            { address: stk, abi: PAPER_STAKING_ABI, functionName: 'pendingReward', args: [userAddress] },
            { address: dpf, abi: DEPOSIT_PROXY_FACTORY_ABI, functionName: 'computeProxyAddress', args: [userAddress] },
            { address: dpf, abi: DEPOSIT_PROXY_FACTORY_ABI, functionName: 'proxyOf', args: [userAddress] },
          ],
          allowFailure: true,
        });

        const uQueueHead = Number(userCalls[1]?.result ?? 0n);
        const openIdsRaw = (userCalls[2]?.result as bigint[]) ?? [];
        const openPositionIds = openIdsRaw.map((id) => Number(id));
        const computedProxy = (userCalls[7]?.result as Address) ?? null;
        const deployedProxyRaw = (userCalls[8]?.result as Address) ?? null;
        const deployedProxy =
          deployedProxyRaw && deployedProxyRaw !== '0x0000000000000000000000000000000000000000'
            ? deployedProxyRaw
            : null;

        let openPositions: OnChainPosition[] = [];
        let proxyUsdcBalance = 0;
        let queuedAmountUsd = 0;

        const extraCalls = [
          ...(computedProxy
            ? [{ address: usdc, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [computedProxy] as const }]
            : []),
          ...(uQueueHead > 0
            ? [{ address: ex, abi: EXCHANGE_ABI, functionName: 'queueNode' as const, args: [BigInt(uQueueHead)] as const }]
            : []),
          ...openPositionIds.map((id) => ({
            address: ex,
            abi: EXCHANGE_ABI,
            functionName: 'positions' as const,
            args: [BigInt(id)] as const,
          })),
        ];

        if (extraCalls.length > 0) {
          const extraRes = await publicClient.multicall({
            contracts: extraCalls,
            allowFailure: true,
          });
          let offset = 0;
          if (computedProxy) {
            proxyUsdcBalance = toUsdc6(extraRes[0]?.result);
            offset += 1;
          }
          if (uQueueHead > 0) {
            const qNodeRes = extraRes[offset];
            if (qNodeRes?.status === 'success' && Array.isArray(qNodeRes.result)) {
              queuedAmountUsd = toUsd18(qNodeRes.result[1]);
            }
            offset += 1;
          }
          for (let k = 0; k < openPositionIds.length; k++) {
            const pRes = extraRes[offset + k];
            if (pRes?.status === 'success') {
              const parsed = parsePositionTuple(openPositionIds[k], pRes.result);
              if (parsed) openPositions.push(parsed);
            }
          }
        }

        setUserState({
          address: userAddress,
          exchangeBalanceUsd: toUsd18(userCalls[0]?.result),
          queuedAmountUsd,
          userQueueHead: uQueueHead,
          walletUsdcBalance: toUsdc6(userCalls[3]?.result),
          paperBalance: toUsd18(userCalls[4]?.result),
          stakedPaper: toUsd18(userCalls[5]?.result),
          pendingRewardUsd: toUsd18(userCalls[6]?.result),
          openPositionIds,
          openPositions,
          computedProxyAddress: computedProxy,
          deployedProxyAddress: deployedProxy,
          proxyUsdcBalance,
        });
      }
    } catch (err) {
      setProtocol((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'RPC sync error',
      }));
    }
  }, [userAddress]);

  useEffect(() => {
    fetchAll();
    const timer = window.setInterval(fetchAll, 3000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  return { protocol, userState, refreshOnChain: fetchAll };
}
