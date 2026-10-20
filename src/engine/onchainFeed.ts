import { useEffect, useState, useCallback, useRef } from 'react';
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
import { assertReadSuccess, sumUserQueue } from './safety';
import { computeMarginalMintRate, INSTRUMENTS } from './papertradeMath';

export interface OnChainPosition {
  id: string;
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
  openPositionIds: string[];
  balanceRaw: bigint;
  queuedRaw: bigint;
  executableQueuedRaw: bigint;
  paperRaw: bigint;
  stakedRaw: bigint;
  lastUpdatedMs: number;
  error: string | null;
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

const emptyUser = (): UserOnChainState => ({ address: null, exchangeBalanceUsd: 0, queuedAmountUsd: 0, userQueueHead: 0, walletUsdcBalance: 0, paperBalance: 0, stakedPaper: 0, pendingRewardUsd: 0, openPositionIds: [], openPositions: [], computedProxyAddress: null, deployedProxyAddress: null, proxyUsdcBalance: 0, balanceRaw: 0n, queuedRaw: 0n, executableQueuedRaw: 0n, paperRaw: 0n, stakedRaw: 0n, lastUpdatedMs: 0, error: null });
export function usePapertradeOnChainFeed(userAddress: Address | null) {
  const generation = useRef(0);
  const running = useRef<Promise<void> | null>(null);
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

  const [userState, setUserState] = useState<UserOnChainState>(emptyUser);

  const parsePositionTuple = (id: string, raw: unknown): OnChainPosition | null => {
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
    if (instNum !== 0 && instNum !== 1) return null;
    return {
      id,
      user: user as Address,
      instrumentId: instNum,
      coin: instNum === 1 ? 'ETH' : 'BTC',
      entryPrice: Number(entryPriceRaw) / INSTRUMENTS[instNum === 1 ? 'ETH' : 'BTC'].priceDecimalsOnChain,
      marginUsd: toUsd18(marginRaw),
      leverage: Number(leverage),
      openedAt: Number(openedAtRaw),
      isLong: Boolean(isLong),
      fromQueued: Boolean(fromQueued),
      isOpen: Boolean(isOpen),
    };
  };

  const fetchAll = useCallback(async () => {
    if (running.current) return running.current;
    const currentGeneration = generation.current;
    const current = () => currentGeneration === generation.current;
    const task = (async () => {
    try {
      const fetchedAt = Date.now();
      const ex = PAPERTRADE_CONTRACTS.Exchange;
      const tok = PAPERTRADE_CONTRACTS.PaperTokenomics;
      const pap = PAPERTRADE_CONTRACTS.PaperToken;
      const stk = PAPERTRADE_CONTRACTS.PaperStaking;

      const blockNumber = await publicClient.getBlockNumber();
      const coreResults = await publicClient.multicall({
          blockNumber,
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
        });
      assertReadSuccess(coreResults, 'Protocol');

      const qHead = Number(coreResults[6].result);
      if (!Number.isSafeInteger(qHead)) throw new Error('Queue identifier exceeds supported display precision.');
      const nextPosRaw = coreResults[7].result as bigint;
      const nextPosId = Number(nextPosRaw);

      // Fetch the 14 most recent on-chain positions to animate the Trading Pit & Basement Press
      const sampleCount = 14;
      const posIdsToQuery: string[] = [];
      for (let i = 1; i <= sampleCount; i++) {
        if (nextPosRaw - BigInt(i) > 0n) posIdsToQuery.push(String(nextPosRaw - BigInt(i)));
      }

      const activeQueueNodes: OnChainQueueNode[] = [];
      let nextQueue = BigInt(qHead);
      const seenQueue = new Set<bigint>();
      while (nextQueue > 0n && activeQueueNodes.length < 8) {
        if (seenQueue.has(nextQueue) || nextQueue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid payout queue.');
        seenQueue.add(nextQueue);
        const [user, amount, next, userNext] = await publicClient.readContract({ address: ex, abi: EXCHANGE_ABI, functionName: 'queueNode', args: [nextQueue], blockNumber });
        if (user === '0x0000000000000000000000000000000000000000') break;
        if (amount > 0n) activeQueueNodes.push({ id: Number(nextQueue), user, amountUsd: toUsd18(amount), next: Number(next), userNext: Number(userNext) });
        nextQueue = next;
        if (seenQueue.size > 1000) throw new Error('Payout queue traversal exceeded safe limit.');
      }

      const secondaryContracts = [
        ...posIdsToQuery.map((id) => ({
          address: ex,
          abi: EXCHANGE_ABI,
          functionName: 'positions' as const,
          args: [BigInt(id)] as const,
        })),

      ];

      const secondaryResults =
        secondaryContracts.length > 0
          ? await publicClient.multicall({
              blockNumber,
              contracts: secondaryContracts,
              allowFailure: true,
            })
          : [];

      assertReadSuccess(secondaryResults, 'Positions/queue');
      const recentPositions: OnChainPosition[] = [];
      for (let i = 0; i < posIdsToQuery.length; i++) {
        const res = secondaryResults[i];
        if (res?.status === 'success') {
          const parsed = parsePositionTuple(posIdsToQuery[i], res.result);
          if (parsed) recentPositions.push(parsed);
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

      if (!current()) return;
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
        lastUpdatedMs: fetchedAt,
      });

      // If user wallet is connected, fetch their personal on-chain state
      if (userAddress) {
        const dpf = PAPERTRADE_CONTRACTS.DepositProxyFactory;
        const usdc = PAPERTRADE_CONTRACTS.USDC;

        const userCalls = await publicClient.multicall({
          blockNumber,
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

        assertReadSuccess(userCalls, 'Account');
        const uQueueHead = Number(userCalls[1]?.result ?? 0n);
        const openIdsRaw = (userCalls[2]?.result as bigint[]) ?? [];
        const openPositionIds = openIdsRaw.map(String);
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

          ...openPositionIds.map((id) => ({
            address: ex,
            abi: EXCHANGE_ABI,
            functionName: 'positions' as const,
            args: [BigInt(id)] as const,
          })),
        ];

        if (extraCalls.length > 0) {
          const extraRes = await publicClient.multicall({
            blockNumber,
            contracts: extraCalls,
            allowFailure: true,
          });
          assertReadSuccess(extraRes, 'Account positions');
          let offset = 0;
          if (computedProxy) {
            proxyUsdcBalance = toUsdc6(extraRes[0]?.result);
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

        const queue = await sumUserQueue(userCalls[1].result as bigint, userAddress, async (id) => {
          const node = await publicClient.readContract({ address: ex, abi: EXCHANGE_ABI, functionName: 'queueNode', args: [id], blockNumber });
          return { user: node[0], amount: node[1], next: node[3] };
        });
        queuedAmountUsd = toUsd18(queue.amount);
        if (!current()) return;
        setUserState({
          balanceRaw: userCalls[0].result as bigint,
          queuedRaw: queue.amount, executableQueuedRaw: queue.executable,
          paperRaw: userCalls[4].result as bigint, stakedRaw: userCalls[5].result as bigint,
          lastUpdatedMs: fetchedAt, error: null,
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
      if (!current()) return;
      setUserState(prev => ({ ...prev, error: 'Account sync failed', lastUpdatedMs: 0 }));
      setProtocol((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'RPC sync error',
      }));
    }
    })();
    running.current = task;
    try { await task; } finally { if (running.current === task) running.current = null; }
  }, [userAddress]);

  useEffect(() => {
    generation.current++;
    running.current = null;
    setUserState(emptyUser());
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await fetchAll();
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => { stopped = true; generation.current++; clearTimeout(timer); };
  }, [fetchAll]);

  return { protocol, userState: userState.address === userAddress ? userState : emptyUser(), refreshOnChain: fetchAll };
}

