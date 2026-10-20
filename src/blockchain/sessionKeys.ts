import { createWalletClient, custom, getAddress, recoverTypedDataAddress, zeroAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hyperEvmChain, publicClient } from '../config/chain';
import { PAPERTRADE_CONTRACTS, SESSION_KEY_MANAGER_ABI } from '../config/contracts';
import { assertWalletAccount, getEthereum } from './wallet';
import { computeIntentId, INTENT_TYPES, intentDomain, newNonce, signedWire } from './protocolIntents';
import { requireRelayer, submitIntent } from './relayer';
export interface StoredSessionKey {
  owner: Address;
  sessionKeyAddress: Address;
  privateKey: Hex;
  expiry: number;
  isOnChainRegistered: boolean;
}
// Private keys live only in memory. Public revocation metadata survives reload.
const keys = new Map<string, StoredSessionKey>();
const prefix = 'papertrade_arcade_session_public_v2_';
const legacyPrefix = 'papertrade_arcade_session_v1_';
export interface SessionMetadata { owner: Address; sessionKeyAddress: Address; expiry: number }
export function sessionMetadata(owner: Address): SessionMetadata[] {
  const storageKey = prefix + owner.toLowerCase();
  const legacyKey = legacyPrefix + owner.toLowerCase();
  const legacy = localStorage.getItem(legacyKey);
  const entries = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as SessionMetadata[];
  if (!Array.isArray(entries)) throw new Error('Session metadata is unreadable. Revoke keys through the official site.');
  if (legacy) {
    const old = JSON.parse(legacy) as SessionMetadata;
    entries.push({ owner: getAddress(owner), sessionKeyAddress: getAddress(old.sessionKeyAddress), expiry: old.expiry });
    localStorage.setItem(storageKey, JSON.stringify(entries));
    localStorage.removeItem(legacyKey); // Never silently discard the revocation address.
  }
  return entries.filter(e => e.owner?.toLowerCase() === owner.toLowerCase() && Number.isSafeInteger(e.expiry)).map(e => ({ ...e, sessionKeyAddress: getAddress(e.sessionKeyAddress) }));
}
export function loadStoredSessionKey(owner: Address | null): StoredSessionKey | null {
  return owner ? keys.get(owner.toLowerCase()) ?? null : null;
}
export async function checkSessionKeyOnChain(owner: Address, sessionKeyAddress: Address) {
  const raw = await publicClient.readContract({ address: PAPERTRADE_CONTRACTS.SessionKeyManager, abi: SESSION_KEY_MANAGER_ABI, functionName: 'sessionKeys', args: [owner, sessionKeyAddress] });
  const onChainExpiry = Number(raw);
  return { isValid: onChainExpiry > Math.floor(Date.now() / 1000) + 300, onChainExpiry };
}
export async function validateSessionKey(key: StoredSessionKey, owner: Address, deadline: number) {
  if (key.owner.toLowerCase() !== owner.toLowerCase() || privateKeyToAccount(key.privateKey).address.toLowerCase() !== key.sessionKeyAddress.toLowerCase()) throw new Error('Session key does not belong to this account.');
  if (key.expiry <= deadline) throw new Error('Session expires too soon. Reauthorize trading.');
  const valid = await checkSessionKeyOnChain(owner, key.sessionKeyAddress);
  if (!valid.isValid || valid.onChainExpiry <= deadline) throw new Error('Session is not registered, expired, or revoked.');
}
export async function createAndSignSessionKey(owner: Address, assertCurrent: () => void = () => {}): Promise<StoredSessionKey> {
  requireRelayer();
  assertCurrent();
  await assertWalletAccount(owner);
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const expiry = Math.floor(Date.now() / 1000) + 30 * 86400;
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const message = { user: owner, key: account.address, expiry: BigInt(expiry), feeAddress: zeroAddress, nonce: newNonce(), deadline: BigInt(deadline) };
  const typed = { domain: intentDomain('RegisterSessionKey'), types: { RegisterSessionKey: INTENT_TYPES.RegisterSessionKey }, primaryType: 'RegisterSessionKey' as const, message };
  const client = createWalletClient({ account: owner, chain: hyperEvmChain, transport: custom(getEthereum()) });
  const signature = await client.signTypedData(typed);
  await assertWalletAccount(owner);
  if ((await recoverTypedDataAddress({ ...typed, signature })).toLowerCase() !== owner.toLowerCase()) throw new Error('Registration was signed by a different account.');
  assertCurrent();
  const key: StoredSessionKey = { owner, sessionKeyAddress: account.address, privateKey, expiry, isOnChainRegistered: false };
  localStorage.setItem(prefix + owner.toLowerCase(), JSON.stringify([...sessionMetadata(owner), { owner, sessionKeyAddress: account.address, expiry }]));
  keys.set(owner.toLowerCase(), key);
  const state = await submitIntent({ id: computeIntentId('RegisterSessionKey', message, owner), user: owner, action: 'registerSessionKey', deadline, state: 'signed' }, signedWire('RegisterSessionKey', message, signature));
  if (['failed', 'reverted', 'expired', 'cancelled'].includes(state)) throw new Error(`Session registration ${state}.`);
  assertCurrent();
  const valid = await checkSessionKeyOnChain(owner, account.address);
  key.isOnChainRegistered = valid.isValid;
  return key;
}
export function clearLocalSessionKey(owner: Address, address?: Address) {
  const current = keys.get(owner.toLowerCase());
  if (!address || current?.sessionKeyAddress.toLowerCase() === address.toLowerCase()) keys.delete(owner.toLowerCase());
  if (address) localStorage.setItem(prefix + owner.toLowerCase(), JSON.stringify(sessionMetadata(owner).filter(e => e.sessionKeyAddress.toLowerCase() !== address.toLowerCase())));
}
export function forgetInMemorySessions() { keys.clear(); }
