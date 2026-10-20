import { beforeEach, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
const { readContract }=vi.hoisted(()=>({readContract:vi.fn()}));
vi.mock('../src/config/chain',async importOriginal=>({...await importOriginal<object>(),publicClient:{readContract}}));
import { validateSessionKey, sessionMetadata, loadStoredSessionKey } from '../src/blockchain/sessionKeys';
import { signPapertradeIntent } from '../src/blockchain/intentBuilder';
import { assertWalletAccount } from '../src/blockchain/wallet';
const owner=privateKeyToAccount(`0x${'01'.repeat(32)}`);
const privateKey=`0x${'02'.repeat(32)}` as const;
const session=privateKeyToAccount(privateKey);
const key={owner:owner.address,sessionKeyAddress:session.address,privateKey,expiry:2000000000,isOnChainRegistered:true};
beforeEach(()=>{localStorage.clear();readContract.mockReset();Object.defineProperty(window,'ethereum',{configurable:true,value:{request:vi.fn(async({method,params})=>{
 if(method==='eth_chainId')return '0x3e7';if(method==='eth_accounts')return [owner.address];
 if(method==='eth_signTypedData_v4')return owner.signTypedData(JSON.parse(params[1]));
 throw new Error(`Unexpected request ${method}`);
})}})});
it('rejects revoked keys despite a cached authorization flag',async()=>{
 readContract.mockResolvedValue(0n);await expect(validateSessionKey(key,owner.address,1900000000)).rejects.toThrow('revoked');
});
it('rejects local expiry, wrong owner, and RPC failures',async()=>{
 await expect(validateSessionKey(key,owner.address,2000000000)).rejects.toThrow('expires');
 await expect(validateSessionKey(key,session.address,1900000000)).rejects.toThrow('belong');
 readContract.mockRejectedValue(new Error('RPC unavailable'));await expect(validateSessionKey(key,owner.address,1900000000)).rejects.toThrow('RPC');
});
it('removes legacy plaintext keys while retaining revocation metadata',()=>{
 const legacy='papertrade_arcade_session_v1_'+owner.address.toLowerCase();localStorage.setItem(legacy,JSON.stringify(key));
 expect(sessionMetadata(owner.address)[0].sessionKeyAddress).toBe(session.address);
 expect(localStorage.getItem(legacy)).toBeNull();expect(JSON.stringify(localStorage)).not.toContain(privateKey);
 expect(loadStoredSessionKey(owner.address)).toBeNull();
});
it.each(['STAKE_PAPER','UNSTAKE_PAPER','CLAIM_REWARDS'] as const)('%s always uses owner signature',async action=>{
 const signed=await signPapertradeIntent({action,user:owner.address,sessionKey:key,amountPaper:'1.000000000000000001'});
 expect(signed.signedWithSessionKey).toBe(false);expect(signed.signerAddress).toBe(owner.address);expect(readContract).not.toHaveBeenCalled();
 if(action!=='CLAIM_REWARDS')expect(JSON.parse(signed.typedDataJson).message.amount).toBe('1000000000000000001');
});
it('rejects wallet account drift',async()=>{await expect(assertWalletAccount(session.address)).rejects.toThrow('account changed')});
