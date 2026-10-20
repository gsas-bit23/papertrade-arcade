import capturedSnapshot from './fixtures/wallet-snapshot.json';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseWalletObservation, reconcileObservation, watchSettlements } from '../src/blockchain/settlement';
import { hasPendingIntent, pendingIntents, recordIntent, type PendingIntent } from '../src/blockchain/relayer';
const owner = `0x${'12'.repeat(20)}` as const;
const id = `0x${'ab'.repeat(32)}` as const;
const intent: PendingIntent = { id, user: owner, action: 'paperStake', deadline: 2000000000, state: 'unknown' };
const snapshot = (accountRevision = 1) => ({ address: owner, accountRevision, operations: [], openPositions: [] });
const patch = (outcome = 'succeeded') => ({ address: owner, accountRevision: 2, baseAccountRevision: 1, state: {}, addedOperations: [], intentOutcomes: [[id, outcome]] });
class FakeSource {
  static instances: FakeSource[] = [];
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: {data: string}) => void>();
  closed = false;
  constructor(public url: string, public options: unknown) { FakeSource.instances.push(this); }
  addEventListener(name: string, fn: (event: {data: string}) => void) { this.listeners.set(name, fn); }
  close() { this.closed = true; }
  emit(name: string, data: unknown) { this.listeners.get(name)?.({data: JSON.stringify(data)}); }
}
beforeEach(() => {
  localStorage.clear(); FakeSource.instances = [];
  let chain = Promise.resolve();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {request: (_: string, fn: () => unknown) => {
    const result = chain.then(fn); chain = result.then(() => undefined, () => undefined); return result;
  }} });
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('requires an initial snapshot and an exact patch base', () => {
  expect(() => parseWalletObservation(patch(), owner, null)).toThrow('gap');
  expect(() => parseWalletObservation({...patch(),baseAccountRevision:3},owner,1)).toThrow('gap');
  expect(parseWalletObservation(snapshot(), owner, null)?.revision).toBe(1);
  expect(parseWalletObservation(patch(),owner,1)?.outcomes[0]).toEqual({id,outcome:'succeeded'});
});
it('rejects foreign accounts, malformed outcomes and duplicate IDs', () => {
  expect(() => parseWalletObservation({...patch(),address:`0x${'34'.repeat(20)}`},owner,1)).toThrow('identity');
  expect(() => parseWalletObservation(patch('confirmed'),owner,1)).toThrow('outcome');
  expect(() => parseWalletObservation({...patch(),intentOutcomes:[[id,'failed'],[id,'succeeded']]},owner,1)).toThrow('outcome');
});
it('ignores old revisions', () => { expect(parseWalletObservation(patch(), owner, 2)).toBeNull(); });
it('persists reported outcomes without claiming receipt verification or allowing duplicates', async () => {
  recordIntent(intent);
  await reconcileObservation(owner, parseWalletObservation(patch(), owner, 1)!);
  expect(pendingIntents()[0].reportedOutcome).toBe('succeeded');
  expect(pendingIntents()[0].state).toBe('unknown');
  expect(hasPendingIntent(owner)).toBe(true);
});
it('keeps acknowledged confirmation guarded until reconciliation', () => {
  recordIntent({...intent,state:'confirmed'});expect(hasPendingIntent(owner)).toBe(true);
});
it('does not infer outcomes from disappearance or an expired local deadline', async () => {
  recordIntent({...intent,deadline:1});
  await reconcileObservation(owner,parseWalletObservation(snapshot(),owner,null)!);
  expect(pendingIntents()[0].reportedOutcome).toBeUndefined();expect(hasPendingIntent(owner)).toBe(true);
});
it('ignores unknown intent IDs and inactive account work', async () => {
  recordIntent(intent);
  await reconcileObservation(owner,{revision:2,operations:[],outcomes:[{id:`0x${'cd'.repeat(32)}`,outcome:'failed'}]});
  await reconcileObservation(owner,parseWalletObservation(patch(),owner,1)!,()=>false);
  expect(pendingIntents()[0].reportedOutcome).toBeUndefined();
});
it('rejects conflicting action and terminal outcome',async()=>{
  recordIntent(intent);
  await expect(reconcileObservation(owner,{revision:2,operations:[{id,action:'openPosition'}],outcomes:[]})).rejects.toThrow('action');
  await reconcileObservation(owner,parseWalletObservation(patch(),owner,1)!);
  await expect(reconcileObservation(owner,parseWalletObservation(patch('failed'),owner,1)!)).rejects.toThrow('Conflicting');
});
it('serializes frames, uses public credentials, and closes on account cleanup',async()=>{
  vi.useFakeTimers();recordIntent(intent);
  const changed=vi.fn(),status=vi.fn();const stop=watchSettlements(owner,changed,status);
  const source=FakeSource.instances[0];expect(source.options).toEqual({withCredentials:false});expect(source.url).toContain('/state/user/live?wallet=');
  source.emit('wallet',snapshot());source.emit('wallet',patch());
  await vi.advanceTimersByTimeAsync(0);
  expect(pendingIntents()[0].reportedOutcome).toBe('succeeded');expect(status).toHaveBeenCalledWith('live');
  stop();expect(source.closed).toBe(true);
  source.emit('wallet',{...patch('failed'),accountRevision:3,baseAccountRevision:2});
  await vi.advanceTimersByTimeAsync(60000);expect(FakeSource.instances).toHaveLength(1);
  expect(pendingIntents()[0].reportedOutcome).toBe('succeeded');
});
it('reconnects after a gap and requires a fresh snapshot',async()=>{
  vi.useFakeTimers();const stop=watchSettlements(owner,vi.fn(),vi.fn());
  FakeSource.instances[0].emit('wallet',patch());await vi.advanceTimersByTimeAsync(1000);
  expect(FakeSource.instances[0].closed).toBe(true);expect(FakeSource.instances).toHaveLength(2);
  FakeSource.instances[1].emit('wallet',snapshot(5));await vi.advanceTimersByTimeAsync(0);
  stop();
});
it('reconnects after silence without resubmitting anything',async()=>{
  vi.useFakeTimers();const stop=watchSettlements(owner,vi.fn(),vi.fn());
  await vi.advanceTimersByTimeAsync(46000);expect(FakeSource.instances).toHaveLength(2);stop();
});

it('accepts the captured public wallet snapshot', () => {
  expect(parseWalletObservation(capturedSnapshot, '0x0000000000000000000000000000000000000001', null)?.revision).toBe(1);
});
