import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { INTENT_TYPES, intentDomain, parseAmount, signedWire, computeIntentId } from '../src/blockchain/protocolIntents';
const account=privateKeyToAccount(`0x${'01'.repeat(32)}`);
it.each(['0','-1','1e3','NaN','Infinity','1.0000000000000000001','01',' 1'])('rejects unsafe amount %s', value => expect(() => parseAmount(value)).toThrow());
it('preserves exact decimal amounts and enforces uint128', () => {
  expect(parseAmount('123.000000000000000001')).toBe(123000000000000000001n);
  expect(() => parseAmount('340282366920938463464',128)).toThrow();
});
it.each(['Stake','Unstake'] as const)('preserves %s amount in a recoverable wire signature', async primaryType => {
  const message={user:account.address,amount:123000000000000000001n,nonce:4n,deadline:2000000000n};
  const typed={domain:intentDomain(primaryType),types:{[primaryType]:INTENT_TYPES[primaryType]},primaryType,message};
  const signature=await account.signTypedData(typed);
  const wire=signedWire(primaryType,message,signature);
  expect(wire.amount).toBe('123000000000000000001');
  expect(await recoverTypedDataAddress({...typed,signature})).toBe(account.address);
  expect(computeIntentId(primaryType,message,account.address)).not.toBe(computeIntentId(primaryType,{...message,amount:1n},account.address));
});
it('separates trading and staking domains', () => {
  expect(intentDomain('OpenPosition').name).toBe('String');
  expect(intentDomain('Stake').name).toBe('PaperStaking');
  expect(intentDomain('Stake').verifyingContract).not.toBe(intentDomain('OpenPosition').verifyingContract);
});
