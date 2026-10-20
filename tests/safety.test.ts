import { describe, expect, it } from 'vitest';
import { assertReadSuccess, isFresh, sumUserQueue } from '../src/engine/safety';
import { applyMarketImpact, INSTRUMENTS, computePositionPnl } from '../src/engine/papertradeMath';
import { assertSuccessfulReceipt } from '../src/blockchain/intentBuilder';
describe('fail closed data and accounting', () => {
  it('rejects stale, absent, and future data', () => {
    for (const timestamp of [0, NaN, 1, 12000]) expect(isFresh(timestamp, 1000, 10000)).toBe(false);
    expect(isFresh(9500, 1000, 10000)).toBe(true);
  });
  it('does not interpret a failed multicall as zero', () => {
    expect(() => assertReadSuccess([{status:'success'}, {status:'failure'}], 'balance')).toThrow('unavailable');
  });
  it('rejects reverted receipts', () => {
    expect(() => assertSuccessfulReceipt({status:'reverted'})).toThrow();
    expect(() => assertSuccessfulReceipt({status:'success'})).not.toThrow();
  });
  it('totals all user tickets and limits executable subset', async () => {
    expect(await sumUserQueue(1n, 'alice', async id => ({user:'Alice', amount:2n, next:id < 60n ? id+1n : 0n}))).toEqual({amount:120n, executable:100n});
  });
  it('rejects cycles and foreign tickets', async () => {
    await expect(sumUserQueue(1n,'alice',async () => ({user:'alice',amount:1n,next:1n}))).rejects.toThrow('cyclic');
    await expect(sumUserQueue(1n,'alice',async () => ({user:'bob',amount:1n,next:0n}))).rejects.toThrow();
  });
  it('uses midpoint entry regardless of size or direction', () => {
    for (const marginUsd of [1,100000]) for (const isLong of [true,false]) expect(applyMarketImpact({midPrice:2500,marginUsd,leverage:1000,isLong,coin:'ETH'}).effectiveEntryPrice).toBe(2500);
    expect(INSTRUMENTS.ETH.priceDecimalsOnChain).toBe(100);
  });
  it('caps isolated losses at margin', () => {
    const pnl=computePositionPnl({symbol:'ETH',entryPrice:2500,currentMidPrice:1000,marginUsd:20,leverage:100,isLong:true,trackedLpUsd:0,tailProgressUsd:0,queueIsEmpty:true});
    expect(pnl.netPnlUsd).toBe(-20); expect(pnl.winFeeUsd).toBe(0);
  });
});
