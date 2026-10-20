import type { Address, Hex } from 'viem';
import type { ProtocolAction } from './protocolIntents';

export function validateRelayerUrl(value: string): string {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Relayer URL must be HTTPS, without credentials, query or fragment.');
  return url.href.replace(/\/$/, '');
}
export const RELAYER_URL = validateRelayerUrl(import.meta.env.VITE_RELAYER_URL ?? '');
export function requireRelayer() {
  if (!RELAYER_URL) throw new Error('Trading is unavailable: a verified relayer connection has not been configured.');
}
export type SubmissionState = 'signed' | 'submitting' | 'queued' | 'prepared' | 'confirmed' | 'failed' | 'reverted' | 'expired' | 'cancelled' | 'unknown';
export interface PendingIntent { id: Hex; user: Address; action: ProtocolAction; deadline: number; state: SubmissionState; reportedOutcome?: 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'unknown'; observedAt?: number }
const STORAGE = 'papertrade_arcade_pending_v2';
export function pendingIntents(): PendingIntent[] {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.some(i => !i || !/^0x[0-9a-f]{64}$/.test(i.id) || !/^0x[0-9a-fA-F]{40}$/.test(i.user) || !Number.isSafeInteger(i.deadline) || !['registerSessionKey','openPosition','closePositions','paperStake','paperUnstake','paperClaim'].includes(i.action) || (i.reportedOutcome !== undefined && !['succeeded','failed','expired','cancelled','unknown'].includes(i.reportedOutcome)) || (i.observedAt !== undefined && (!Number.isSafeInteger(i.observedAt) || i.observedAt < 0)) || !['signed','submitting','queued','prepared','confirmed','failed','reverted','expired','cancelled','unknown'].includes(i.state))) throw new Error('Saved submission history is unreadable. Review your account before clearing it.');
  return data;
}
export function hasPendingIntent(user: Address) {
  return pendingIntents().some(i => i.user.toLowerCase() === user.toLowerCase() && ['submitting','queued','prepared','unknown','confirmed'].includes(i.state));
}
export function recordIntent(intent: PendingIntent) {
  const items = pendingIntents();
  localStorage.setItem(STORAGE, JSON.stringify([intent, ...items.filter(i => i.id !== intent.id)]));
}
export async function acknowledgePending(user: Address) {
  if (!navigator.locks) throw new Error('Browser submission coordination is unavailable.');
  return navigator.locks.request(`papertrade-submit:999:${user.toLowerCase()}`, () => {
  // Explicit user reconciliation only; TTL expiry alone does not prove failure.
  localStorage.setItem(STORAGE, JSON.stringify(pendingIntents().filter(i => i.user.toLowerCase() !== user.toLowerCase())));
  });
}
export function validateAcknowledgement(data: unknown, intent: PendingIntent): SubmissionState {
  const value = data as { intentId?: unknown; action?: unknown; state?: unknown; queueRevision?: unknown };
  if (!value || value.intentId !== intent.id || value.action !== intent.action || typeof value.queueRevision !== 'string' || !/^\d+$/.test(value.queueRevision) || !['queued','prepared','confirmed','failed','reverted','expired','cancelled'].includes(String(value.state))) throw new Error('Could not verify the relayer acknowledgement. Check your account before retrying.');
  return value.state as SubmissionState;
}
async function submitUnlocked(intent: PendingIntent, signed: Record<string, unknown>): Promise<SubmissionState> {
  requireRelayer();
  if (intent.deadline <= Date.now() / 1000) throw new Error('Signature expired. Review and sign again.');
  if (hasPendingIntent(intent.user)) throw new Error('A previous request is unresolved. Review its outcome before submitting another.');
  recordIntent({ ...intent, state: 'submitting' }); // Must succeed before network I/O.
  try {
    const response = await fetch(`${RELAYER_URL}/intents`, { method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ action: intent.action, signed }) });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(`Relayer returned HTTP ${response.status}. Check your account before retrying.`);
    const state = validateAcknowledgement(data, intent);
    recordIntent({ ...intent, state });
    return state;
  } catch (error) {
    recordIntent({ ...intent, state: 'unknown' });
    throw new Error(`${error instanceof Error ? error.message : 'Submission failed.'} Execution is unconfirmed; do not resubmit blindly.`);
  }
}

// Coordinate pending reservations across same-origin tabs before any request.
export async function submitIntent(intent: PendingIntent, signed: Record<string, unknown>): Promise<SubmissionState> {
  requireRelayer();
  if (!navigator.locks) throw new Error('This browser cannot safely coordinate submissions across tabs. Use a current browser.');
  return navigator.locks.request(`papertrade-submit:999:${intent.user.toLowerCase()}`, () => submitUnlocked(intent, signed));
}
