import {
  Address,
  Hex,
  createWalletClient,
  custom,
  parseUnits,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hyperEvmChain, publicClient } from '../config/chain';
import {
  PAPERTRADE_CONTRACTS,
  EXCHANGE_ABI,
  DEPOSIT_PROXY_FACTORY_ABI,
  SESSION_KEY_MANAGER_ABI,
} from '../config/contracts';
import { BuilderCodeConfig } from '../config/builderCode';
import { StoredSessionKey } from './sessionKeys';

export type IntentActionType =
  | 'OPEN_POSITION'
  | 'CLOSE_POSITION'
  | 'STAKE_PAPER'
  | 'UNSTAKE_PAPER'
  | 'CLAIM_REWARDS';

export interface SignedTradeIntent {
  id: string;
  action: IntentActionType;
  user: Address;
  signerAddress: Address;
  signedWithSessionKey: boolean;
  instrumentId?: number;
  coin?: 'BTC' | 'ETH';
  isLong?: boolean;
  marginUsd?: string;
  leverage?: number;
  spendQueuedBalance?: boolean;
  positionId?: number;
  amountPaper?: string;
  nonce: number;
  deadline: number;
  builderCode: string;
  builderFeeShareBps: number;
  signature: Hex;
  typedDataJson: string;
  relayerStatus: 'SIGNED_READY' | 'RELAYED' | 'RELAYER_OFFLINE_SAVED';
  createdAt: number;
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EthereumProvider {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) {
    throw new Error('No injected EVM wallet found. Please open Rabby or MetaMask.');
  }
  return eth;
}

export async function ensureHyperEvmNetwork(): Promise<void> {
  const eth = getEthereum();
  const chainIdHex = (await eth.request({ method: 'eth_chainId' })) as string;
  if (parseInt(chainIdHex, 16) !== hyperEvmChain.id) {
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x3e7' }], // 999 in hex
      });
    } catch (switchErr: unknown) {
      const code = (switchErr as { code?: number })?.code;
      if (code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: '0x3e7',
              chainName: 'HyperEVM',
              nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
              rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
              blockExplorerUrls: ['https://hyperevmscan.io'],
            },
          ],
        });
      } else {
        throw switchErr;
      }
    }
  }
}

export async function connectEvmWallet(): Promise<Address> {
  const eth = getEthereum();
  const accounts = (await eth.request({
    method: 'eth_requestAccounts',
  })) as Address[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No wallet account authorized.');
  }
  await ensureHyperEvmNetwork();
  return accounts[0];
}

/**
 * Signs an off-chain Papertrade Intent using either the 1-Click 30-Day Session Key
 * (instant, zero wallet popup) or the user's primary EVM wallet, and attaches the
 * Phase 3 `builderCode` attribution field.
 */
export async function signPapertradeIntent(params: {
  action: IntentActionType;
  user: Address;
  sessionKey: StoredSessionKey | null;
  builderConfig: BuilderCodeConfig;
  instrumentId?: number;
  coin?: 'BTC' | 'ETH';
  isLong?: boolean;
  marginUsd?: number;
  leverage?: number;
  spendQueuedBalance?: boolean;
  positionId?: number;
  amountPaper?: number;
}): Promise<SignedTradeIntent> {
  const nonce = Math.floor(Date.now());
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 min intent TTL

  const domain = {
    name: 'PapertradeExchange',
    version: '1',
    chainId: hyperEvmChain.id,
    verifyingContract: PAPERTRADE_CONTRACTS.Exchange,
  } as const;

  const types = {
    PapertradeIntent: [
      { name: 'action', type: 'string' },
      { name: 'user', type: 'address' },
      { name: 'instrumentId', type: 'uint32' },
      { name: 'isLong', type: 'bool' },
      { name: 'marginWei', type: 'uint256' },
      { name: 'leverage', type: 'uint16' },
      { name: 'spendQueuedBalance', type: 'bool' },
      { name: 'positionId', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
      { name: 'builderCode', type: 'string' },
    ],
  } as const;

  const marginWei = parseUnits((params.marginUsd ?? params.amountPaper ?? 0).toString(), 18);

  const message = {
    action: params.action,
    user: params.user,
    instrumentId: params.instrumentId ?? 0,
    isLong: Boolean(params.isLong),
    marginWei,
    leverage: params.leverage ?? 1000,
    spendQueuedBalance: Boolean(params.spendQueuedBalance),
    positionId: BigInt(params.positionId ?? 0),
    nonce: BigInt(nonce),
    deadline: BigInt(deadline),
    builderCode: params.builderConfig.enabled ? params.builderConfig.builderCode : '',
  };

  let signature: Hex;
  let signerAddress: Address;
  let signedWithSessionKey = false;

  if (params.sessionKey) {
    // 1-Click instant signing in-memory with the 30-day Session Key!
    const skAccount = privateKeyToAccount(params.sessionKey.privateKey);
    signature = await skAccount.signTypedData({
      domain,
      types,
      primaryType: 'PapertradeIntent',
      message,
    });
    signerAddress = skAccount.address;
    signedWithSessionKey = true;
  } else {
    // Fallback to wallet popup EIP-712 signature
    await ensureHyperEvmNetwork();
    const eth = getEthereum();
    const jsonPayload = JSON.stringify(
      {
        domain,
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          ...types,
        },
        primaryType: 'PapertradeIntent',
        message: {
          ...message,
          marginWei: message.marginWei.toString(),
          positionId: message.positionId.toString(),
          nonce: message.nonce.toString(),
          deadline: message.deadline.toString(),
        },
      },
      null,
      2
    );
    signature = (await eth.request({
      method: 'eth_signTypedData_v4',
      params: [params.user, jsonPayload],
    })) as Hex;
    signerAddress = params.user;
  }

  const typedDataJson = JSON.stringify(
    {
      intent: {
        action: params.action,
        user: params.user,
        signer: signerAddress,
        signedWithSessionKey,
        instrument: params.coin ?? 'BTC',
        isLong: params.isLong,
        marginUsd: params.marginUsd,
        leverage: params.leverage,
        spendQueuedBalance: params.spendQueuedBalance,
        positionId: params.positionId,
        nonce,
        deadline,
      },
      builderAttribution: {
        builderCode: params.builderConfig.builderCode,
        feeShareBps: params.builderConfig.feeShareBps,
        activeOnChain: params.builderConfig.phase3Live,
      },
      sessionKeyAuth: params.sessionKey
        ? {
            sessionKey: params.sessionKey.sessionKeyAddress,
            expiry: params.sessionKey.expiry,
            ownerRegistrationSig: params.sessionKey.registrationSignature,
          }
        : null,
      signature,
    },
    null,
    2
  );

  return {
    id: `intent-${nonce}`,
    action: params.action,
    user: params.user,
    signerAddress,
    signedWithSessionKey,
    instrumentId: params.instrumentId,
    coin: params.coin,
    isLong: params.isLong,
    marginUsd: params.marginUsd?.toFixed(2),
    leverage: params.leverage,
    spendQueuedBalance: params.spendQueuedBalance,
    positionId: params.positionId,
    amountPaper: params.amountPaper?.toFixed(2),
    nonce,
    deadline,
    builderCode: params.builderConfig.builderCode,
    builderFeeShareBps: params.builderConfig.feeShareBps,
    signature,
    typedDataJson,
    relayerStatus: 'SIGNED_READY',
    createdAt: Date.now(),
  };
}

/**
 * Direct on-chain transactions on HyperEVM (Chain 999) for permissionless
 * protocol cranks & user self-service functions:
 * - harvest(maxIterations) on Exchange (drains FIFO Queue using LP Bankroll)
 * - pushStakerFees() on Exchange (flushes accumulated staker fees to PaperStaking)
 * - requestSweep(user) / finalizeSweep(user) on DepositProxyFactory
 * - liquidate(posId) on Exchange
 * - revokeSessionKey(sessionKey) on SessionKeyManager
 */
async function getWalletClient(account: Address) {
  await ensureHyperEvmNetwork();
  const eth = getEthereum();
  return createWalletClient({
    account,
    chain: hyperEvmChain,
    transport: custom(eth),
  });
}

export async function callOnChainHarvest(
  account: Address,
  maxIterations = 32n
): Promise<Hex> {
  const walletClient = await getWalletClient(account);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'harvest',
    args: [maxIterations],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callOnChainPushStakerFees(account: Address): Promise<Hex> {
  const walletClient = await getWalletClient(account);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'pushStakerFees',
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callOnChainRequestSweep(
  caller: Address,
  targetUser: Address
): Promise<Hex> {
  const walletClient = await getWalletClient(caller);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'requestSweep',
    args: [targetUser],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callOnChainFinalizeSweep(
  caller: Address,
  targetUser: Address
): Promise<Hex> {
  const walletClient = await getWalletClient(caller);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'finalizeSweep',
    args: [targetUser],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callOnChainLiquidate(
  caller: Address,
  posId: bigint
): Promise<Hex> {
  const walletClient = await getWalletClient(caller);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'liquidate',
    args: [posId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callOnChainRevokeSessionKey(
  owner: Address,
  sessionKey: Address
): Promise<Hex> {
  const walletClient = await getWalletClient(owner);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.SessionKeyManager,
    abi: SESSION_KEY_MANAGER_ABI,
    functionName: 'revokeSessionKey',
    args: [sessionKey],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
