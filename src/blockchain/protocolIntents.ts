import { concatHex, hashTypedData, keccak256, parseSignature, parseUnits, stringToHex, type Address, type Hex, type TypedDataDomain } from 'viem';
import { PAPERTRADE_CONTRACTS } from '../config/contracts';

// Interoperability definitions verified against the canonical frontend's
// typed-data-B0hqt2-N.js on 2026-10-20. See docs/INTEGRATION.md.
export const INTENT_TYPES = {
  RegisterSessionKey: [{ name: 'user', type: 'address' }, { name: 'key', type: 'address' }, { name: 'expiry', type: 'uint64' }, { name: 'feeAddress', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
  OpenPosition: [{ name: 'user', type: 'address' }, { name: 'instrumentId', type: 'uint32' }, { name: 'isLong', type: 'bool' }, { name: 'size', type: 'uint128' }, { name: 'leverage', type: 'uint32' }, { name: 'useDebt', type: 'bool' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
  Close: [{ name: 'user', type: 'address' }, { name: 'positionIds', type: 'uint256[]' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
  Stake: [{ name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
  Unstake: [{ name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
  Claim: [{ name: 'user', type: 'address' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint64' }],
} as const;
export type PrimaryType = keyof typeof INTENT_TYPES;
export type ProtocolAction = 'registerSessionKey' | 'openPosition' | 'closePositions' | 'paperStake' | 'paperUnstake' | 'paperClaim';
export function intentDomain(primary: PrimaryType): TypedDataDomain {
  const staking = ['Stake', 'Unstake', 'Claim'].includes(primary);
  return { name: staking ? 'PaperStaking' : 'String', version: '1', chainId: 999, verifyingContract: staking ? PAPERTRADE_CONTRACTS.PaperStaking : PAPERTRADE_CONTRACTS.Exchange };
}
export function parseAmount(value: string, bits = 256): bigint {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) throw new Error('Enter a positive decimal amount with at most 18 decimal places.');
  const raw = parseUnits(value, 18);
  if (raw <= 0n || raw >= 1n << BigInt(bits)) throw new Error('Amount is outside the supported range.');
  return raw;
}
export function wireMessage(primary: PrimaryType, message: Record<string, unknown>) {
  return Object.fromEntries(INTENT_TYPES[primary].map(({ name, type }) => {
    const value = message[name];
    if (value === undefined) throw new Error(`Missing signed field: ${name}`);
    return [name, type === 'uint256[]' ? (value as bigint[]).map(String) : type.startsWith('uint') ? String(value) : type === 'address' ? String(value).toLowerCase() : value];
  }));
}
export function signedWire(primary: PrimaryType, message: Record<string, unknown>, signature: Hex) {
  const { r, s, v, yParity } = parseSignature(signature);
  return { ...wireMessage(primary, message), r, s, v: String(v ?? BigInt(27 + (yParity ?? 0))) };
}
export function computeIntentId(primary: PrimaryType, message: Record<string, unknown>, signer: Address): Hex {
  const digest = hashTypedData({ domain: intentDomain(primary), types: { [primary]: INTENT_TYPES[primary] }, primaryType: primary, message });
  return keccak256(concatHex([keccak256(stringToHex('papertrade:intent-id:v2')), digest, signer.toLowerCase() as Address]));
}
// Random 128-bit nonces avoid cross-tab and cross-device collisions in the
// protocol's unordered nonce space without persisting key material.
export function newNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytes.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
}
