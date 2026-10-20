import { createWalletClient, custom, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hyperEvmChain, publicClient } from '../config/chain';
import { PAPERTRADE_CONTRACTS, EXCHANGE_ABI, SESSION_KEY_MANAGER_ABI } from '../config/contracts';
import type { BuilderCodeConfig } from '../config/builderCode';
import { validateSessionKey, type StoredSessionKey } from './sessionKeys';
import { assertWalletAccount, getEthereum, ensureHyperEvmNetwork } from './wallet';
import { computeIntentId, INTENT_TYPES, intentDomain, newNonce, parseAmount, signedWire, wireMessage, type PrimaryType, type ProtocolAction } from './protocolIntents';
import { requireRelayer, hasPendingIntent, submitIntent, type SubmissionState } from './relayer';
export { connectEvmWallet } from './wallet';
export type IntentActionType = 'OPEN_POSITION' | 'CLOSE_POSITION' | 'STAKE_PAPER' | 'UNSTAKE_PAPER' | 'CLAIM_REWARDS';
export interface SignedTradeIntent {
  id: Hex; action: IntentActionType; user: Address; signerAddress: Address;
  signedWithSessionKey: boolean; signature: Hex; typedDataJson: string;
  deadline: number; createdAt: number; relayerStatus: SubmissionState;
  protocolAction: ProtocolAction; signed: Record<string, unknown>;
}
const actions: Record<IntentActionType, [PrimaryType, ProtocolAction]> = {
  OPEN_POSITION: ['OpenPosition', 'openPosition'], CLOSE_POSITION: ['Close', 'closePositions'],
  STAKE_PAPER: ['Stake', 'paperStake'], UNSTAKE_PAPER: ['Unstake', 'paperUnstake'], CLAIM_REWARDS: ['Claim', 'paperClaim'],
};
export async function signPapertradeIntent(params: {
  action: IntentActionType; user: Address; sessionKey: StoredSessionKey | null;
  builderConfig?: BuilderCodeConfig; instrumentId?: number; coin?: 'BTC' | 'ETH';
  isLong?: boolean; marginUsd?: string; leverage?: number; spendQueuedBalance?: boolean;
  positionId?: string; amountPaper?: string;
}): Promise<SignedTradeIntent> {
  requireRelayer();
  await assertWalletAccount(params.user);
  if (hasPendingIntent(params.user)) throw new Error('Review the unresolved request before signing another action.');
  const [primaryType, protocolAction] = actions[params.action];
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const message: Record<string, unknown> = { user: params.user, nonce: newNonce(), deadline: BigInt(deadline) };
  if (primaryType === 'OpenPosition') {
    if (![0, 1].includes(params.instrumentId ?? -1) || !Number.isInteger(params.leverage) || params.leverage! < 1 || params.leverage! > 1000 || typeof params.isLong !== 'boolean') throw new Error('Invalid market, direction, or leverage.');
    Object.assign(message, { instrumentId: params.instrumentId, isLong: params.isLong, size: parseAmount(params.marginUsd ?? '', 128), leverage: params.leverage, useDebt: Boolean(params.spendQueuedBalance) });
  } else if (primaryType === 'Close') {
    if (!/^[1-9]\d*$/.test(params.positionId ?? '') || BigInt(params.positionId!) >= 1n << 256n) throw new Error('Invalid position ID.');
    message.positionIds = [BigInt(params.positionId!)];
  } else if (primaryType === 'Stake' || primaryType === 'Unstake') message.amount = parseAmount(params.amountPaper ?? '');
  const typed = { domain: intentDomain(primaryType), types: { [primaryType]: INTENT_TYPES[primaryType] }, primaryType, message };
  // Staking is ALWAYS owner-authorized, even when a trading session exists.
  const key = primaryType === 'OpenPosition' || primaryType === 'Close' ? params.sessionKey : null;
  let signature: Hex;
  let signerAddress = params.user;
  if (key) {
    await validateSessionKey(key, params.user, deadline);
    const account = privateKeyToAccount(key.privateKey);
    signature = await account.signTypedData(typed);
    signerAddress = account.address;
  } else {
    const client = await getWalletClient(params.user);
    signature = await client.signTypedData(typed);
  }
  await assertWalletAccount(params.user);
  if (deadline <= Date.now() / 1000) throw new Error('Signing took too long. Review and sign again.');
  if ((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase() !== signerAddress.toLowerCase()) throw new Error('Unexpected signature signer.');
  return { id: computeIntentId(primaryType, message, signerAddress), action: params.action, user: params.user, signerAddress, signedWithSessionKey: !!key, signature,
    typedDataJson: JSON.stringify({ ...typed, message: wireMessage(primaryType, message), signature }, null, 2),
    deadline, createdAt: Date.now(), relayerStatus: 'signed', protocolAction, signed: signedWire(primaryType, message, signature) };
}
export async function executeSignedIntent(intent: SignedTradeIntent): Promise<SignedTradeIntent> {
  await assertWalletAccount(intent.user);
  const state = await submitIntent({ id: intent.id, user: intent.user, action: intent.protocolAction, deadline: intent.deadline, state: 'signed' }, intent.signed);
  return { ...intent, relayerStatus: state };
}
export function assertSuccessfulReceipt(receipt: { status: string }) {
  if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain. No successful execution was confirmed.');
}

async function getWalletClient(account: Address) {
  await ensureHyperEvmNetwork();
  await assertWalletAccount(account);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
  return hash;
}

export async function callOnChainPushStakerFees(account: Address): Promise<Hex> {
  const walletClient = await getWalletClient(account);
  const hash = await walletClient.writeContract({
    address: PAPERTRADE_CONTRACTS.Exchange,
    abi: EXCHANGE_ABI,
    functionName: 'pushStakerFees',
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertSuccessfulReceipt(receipt);
  return hash;
}

