import type { Address, Hex } from 'viem';
import { pendingIntents, recordIntent, RELAYER_URL, validateRelayerUrl } from './relayer';

export const STATUS_URL = validateRelayerUrl(import.meta.env.VITE_STATUS_URL ?? (RELAYER_URL || 'https://exchange.papertrade.xyz'));
export type Outcome = 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'unknown';
export interface WalletObservation {
  revision: number;
  outcomes: { id: Hex; outcome: Outcome }[];
  operations: { id: Hex; action: string }[];
}
const hash = /^0x[0-9a-f]{64}$/;
const actions = ['openPosition', 'closePositions', 'withdrawToCore', 'registerSessionKey', 'paperStake', 'paperUnstake', 'paperClaim', 'paperDistribute'];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid wallet frame.');
  return value as Record<string, unknown>;
}
function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid account revision.');
  return value;
}
// Parse only lifecycle fields; this is not a replacement for balance/position reads.
// Patches must extend the exact snapshot revision, including after reconnection.
export function parseWalletObservation(raw: unknown, owner: Address, previous: number | null): WalletObservation | null {
  const frame = object(raw);
  if (typeof frame.address !== 'string' || frame.address.toLowerCase() !== owner.toLowerCase()) throw new Error('Wallet stream identity mismatch.');
  const next = revision(frame.accountRevision);
  const patch = Object.hasOwn(frame, 'baseAccountRevision');
  if (previous !== null && next <= previous) return null;
  if (patch && (previous === null || revision(frame.baseAccountRevision) !== previous)) throw new Error('Wallet stream revision gap.');
  if (!patch && (!Array.isArray(frame.openPositions) || !Array.isArray(frame.operations))) throw new Error('Missing wallet snapshot.');
  if (patch) object(frame.state);
  const outcomesRaw = patch ? frame.intentOutcomes ?? [] : [];
  const operationsRaw = patch ? frame.addedOperations : frame.operations;
  if (!Array.isArray(outcomesRaw) || !Array.isArray(operationsRaw)) throw new Error('Invalid wallet lifecycle data.');
  const seen = new Set<string>();
  const outcomes = outcomesRaw.map(value => {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !hash.test(value[0]) || !['succeeded','failed','expired','cancelled','unknown'].includes(value[1]) || seen.has(value[0])) throw new Error('Invalid intent outcome.');
    seen.add(value[0]);
    return { id: value[0] as Hex, outcome: value[1] as Outcome };
  });
  const operations = operationsRaw.map(value => {
    if (!Array.isArray(value) || value.length !== 10 || typeof value[0] !== 'string' || !hash.test(value[0]) || !actions.includes(value[1])) throw new Error('Invalid operation.');
    return { id: value[0] as Hex, action: value[1] as string };
  });
  return { revision: next, outcomes, operations };
}

export async function reconcileObservation(owner: Address, observation: WalletObservation, current: () => boolean = () => true) {
  if (!navigator.locks) throw new Error('Browser submission coordination is unavailable.');
  return navigator.locks.request(`papertrade-submit:999:${owner.toLowerCase()}`, () => {
    if (!current()) return;
    for (const intent of pendingIntents().filter(i => i.user.toLowerCase() === owner.toLowerCase())) {
      const outcome = observation.outcomes.find(o => o.id === intent.id);
      const operation = observation.operations.find(o => o.id === intent.id);
      if (operation && operation.action !== intent.action) throw new Error('Stream action mismatch.');
      // Never infer success from disappearance, elapsed deadline, or a balance change.
      if (outcome) {
        if (intent.reportedOutcome && intent.reportedOutcome !== 'unknown' && outcome.outcome !== intent.reportedOutcome) throw new Error('Conflicting reported outcome; reconcile on-chain.');
        recordIntent({ ...intent, reportedOutcome: outcome.outcome, observedAt: Date.now() });
      } else if (operation && !intent.reportedOutcome && ['submitting','unknown','queued','prepared'].includes(intent.state)) {
        recordIntent({ ...intent, state: 'queued', observedAt: Date.now() });
      }
    }
  });
}

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';
export function watchSettlements(owner: Address, onChange: () => void, onStatus: (status: StreamStatus) => void) {
  let stopped = false;
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let failures = 0;
  let previous: number | null = null;
  let work = Promise.resolve();
  const close = () => { source?.close(); source = null; clearTimeout(watchdog); };
  const retry = () => {
    if (stopped) return;
    generation++;
    close(); clearTimeout(timer);
    previous = null;
    onStatus('reconnecting');
    timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)));
  };
  const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(retry, 45_000); };
  const connect = () => {
    if (stopped) return;
    const token = ++generation;
    const current = () => !stopped && token === generation;
    previous = null;
    try {
      // The verified public stream permits wildcard CORS; do not attach cookies.
      source = new EventSource(`${STATUS_URL}/state/user/live?wallet=${encodeURIComponent(owner.toLowerCase())}`, { withCredentials: false });
      alive();
      source.onerror = () => { if (current()) retry(); };
      source.addEventListener('heartbeat', event => {
        if (!current()) return;
        if ((event as MessageEvent).data !== 'null') { retry(); return; }
        alive();
      });
      source.addEventListener('wallet', event => {
        if (!current()) return;
        const data = (event as MessageEvent<string>).data;
        work = work.then(async () => {
          if (!current()) return;
          if (data.length > 1_000_000) throw new Error('Oversized wallet frame.');
          const observation = parseWalletObservation(JSON.parse(data), owner, previous);
          if (observation) {
            await reconcileObservation(owner, observation, current);
            if (!current()) return;
            previous = observation.revision;
            failures = 0;
            onChange();
            onStatus('live');
          }
          alive();
        }).catch(() => { if (current()) retry(); });
      });
    } catch { close(); onStatus('unavailable'); retry(); }
  };
  onStatus('connecting');
  connect();
  return () => { stopped = true; generation++; close(); clearTimeout(timer); };
}
