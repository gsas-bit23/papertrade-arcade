import { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hyperEvmChain, publicClient } from '../config/chain';
import { PAPERTRADE_CONTRACTS, SESSION_KEY_MANAGER_ABI } from '../config/contracts';

export interface StoredSessionKey {
  owner: Address;
  sessionKeyAddress: Address;
  privateKey: Hex;
  expiry: number; // unix seconds
  registrationSignature: Hex;
  createdAt: number;
  isOnChainRegistered: boolean;
}

const STORAGE_PREFIX = 'papertrade_arcade_session_v1_';

export function loadStoredSessionKey(owner: Address | null): StoredSessionKey | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${owner.toLowerCase()}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSessionKey;
    if (parsed.expiry * 1000 <= Date.now()) {
      localStorage.removeItem(`${STORAGE_PREFIX}${owner.toLowerCase()}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function checkSessionKeyOnChain(
  owner: Address,
  sessionKeyAddress: Address
): Promise<{ isValid: boolean; onChainExpiry: number }> {
  try {
    const expiryRaw = await publicClient.readContract({
      address: PAPERTRADE_CONTRACTS.SessionKeyManager,
      abi: SESSION_KEY_MANAGER_ABI,
      functionName: 'sessionKeys',
      args: [owner, sessionKeyAddress],
    });
    const onChainExpiry = Number(expiryRaw);
    const nowSec = Math.floor(Date.now() / 1000);
    return {
      isValid: onChainExpiry > nowSec,
      onChainExpiry,
    };
  } catch {
    return { isValid: false, onChainExpiry: 0 };
  }
}

export async function createAndSignSessionKey(
  owner: Address
): Promise<StoredSessionKey> {
  const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth) {
    throw new Error('No EVM wallet detected (install Rabby or MetaMask).');
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  // 30 days validity matching Papertrade SessionKeyManager standard
  const expiry = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const typedData = {
    domain: {
      name: 'PapertradeSessionKeyManager',
      version: '1',
      chainId: hyperEvmChain.id,
      verifyingContract: PAPERTRADE_CONTRACTS.SessionKeyManager,
    },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      RegisterSessionKey: [
        { name: 'owner', type: 'address' },
        { name: 'sessionKey', type: 'address' },
        { name: 'expiry', type: 'uint64' },
      ],
    },
    primaryType: 'RegisterSessionKey',
    message: {
      owner,
      sessionKey: account.address,
      expiry: expiry.toString(),
    },
  };

  const signature = (await eth.request({
    method: 'eth_signTypedData_v4',
    params: [owner, JSON.stringify(typedData)],
  })) as Hex;

  const stored: StoredSessionKey = {
    owner,
    sessionKeyAddress: account.address,
    privateKey,
    expiry,
    registrationSignature: signature,
    createdAt: Date.now(),
    isOnChainRegistered: false,
  };

  localStorage.setItem(
    `${STORAGE_PREFIX}${owner.toLowerCase()}`,
    JSON.stringify(stored)
  );
  return stored;
}

export function clearLocalSessionKey(owner: Address) {
  localStorage.removeItem(`${STORAGE_PREFIX}${owner.toLowerCase()}`);
}
