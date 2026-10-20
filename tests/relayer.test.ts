import { beforeEach, expect, it, vi } from 'vitest';
import { submitIntent, hasPendingIntent, pendingIntents, validateRelayerUrl, acknowledgePending, type PendingIntent } from '../src/blockchain/relayer';
const intent: PendingIntent={id:`0x${'ab'.repeat(32)}`,user:`0x${'12'.repeat(20)}`,action:'paperStake',deadline:2000000000,state:'signed'};
beforeEach(() => {
 localStorage.clear(); vi.restoreAllMocks();
 let chain=Promise.resolve();
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_name:string,fn:()=>Promise<unknown>)=>{const result=chain.then(fn);chain=result.then(()=>undefined,()=>undefined);return result;}}});
});
it.each(['http://relayer.test','https://u:p@relayer.test','https://relayer.test?a=1','https://relayer.test/#x'])('rejects unsafe endpoint %s', value=>expect(()=>validateRelayerUrl(value)).toThrow());
it('keeps uncertain requests blocked even past expiry',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('network')));
 await expect(submitIntent(intent,{})).rejects.toThrow('unconfirmed');
 expect(pendingIntents()[0].state).toBe('unknown'); expect(hasPendingIntent(intent.user)).toBe(true);
 await expect(submitIntent({...intent,deadline:2000000010},{})).rejects.toThrow('unresolved');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects an acknowledgement for another intent',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({intentId:'wrong',action:intent.action,state:'confirmed',queueRevision:'1'})}));
 await expect(submitIntent(intent,{})).rejects.toThrow('acknowledgement');
 expect(hasPendingIntent(intent.user)).toBe(true);
});
it('serializes concurrent submissions and preserves acceptance versus execution',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({intentId:intent.id,action:intent.action,state:'queued',queueRevision:'1'})}));
 const result=await Promise.allSettled([submitIntent(intent,{}),submitIntent(intent,{})]);
 expect(result.map(x=>x.status)).toEqual(['fulfilled','rejected']); expect(fetch).toHaveBeenCalledTimes(1);
 expect(pendingIntents()[0].state).toBe('queued');
 await acknowledgePending(intent.user); expect(hasPendingIntent(intent.user)).toBe(false);
});
it('does not send when persistence fails',async()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')});
 vi.stubGlobal('fetch',vi.fn()); await expect(submitIntent(intent,{})).rejects.toThrow('quota'); expect(fetch).not.toHaveBeenCalled();
});
it('does not send expired signatures',async()=>{
 vi.stubGlobal('fetch',vi.fn()); await expect(submitIntent({...intent,deadline:1},{})).rejects.toThrow('expired');expect(fetch).not.toHaveBeenCalled();
});
