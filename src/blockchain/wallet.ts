import { getAddress, type Address } from 'viem';
import { hyperEvmChain } from '../config/chain';
export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
export function getEthereum(): EthereumProvider {
  const provider = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!provider) throw new Error('Connect an injected EVM wallet such as Rabby or MetaMask.');
  return provider;
}
export async function ensureHyperEvmNetwork() {
  const provider = getEthereum();
  if (Number(await provider.request({ method: 'eth_chainId' })) !== hyperEvmChain.id) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3e7' }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x3e7', chainName: 'HyperEVM', nativeCurrency: hyperEvmChain.nativeCurrency, rpcUrls: hyperEvmChain.rpcUrls.default.http, blockExplorerUrls: ['https://hyperevmscan.io'] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3e7' }] });
    }
  }
  if (Number(await provider.request({ method: 'eth_chainId' })) !== 999) throw new Error('Switch your wallet to HyperEVM.');
}
export async function assertWalletAccount(owner: Address) {
  const provider = getEthereum();
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== owner.toLowerCase()) throw new Error('Wallet account changed. Reconnect and review the action.');
  if (Number(await provider.request({ method: 'eth_chainId' })) !== 999) throw new Error('Wallet network changed. Reconnect on HyperEVM.');
}
export async function connectEvmWallet(): Promise<Address> {
  const accounts = await getEthereum().request({ method: 'eth_requestAccounts' });
  if (!Array.isArray(accounts) || !accounts[0]) throw new Error('No wallet account authorized.');
  await ensureHyperEvmNetwork();
  const owner = getAddress(accounts[0]);
  await assertWalletAccount(owner);
  return owner;
}
