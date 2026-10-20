import { createPublicClient, createWalletClient, custom, defineChain, http } from 'viem';

export const hyperEvm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: {
    name: 'HYPE',
    symbol: 'HYPE',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
    },
  },
  blockExplorers: {
    default: {
      name: 'HyperEVMScan',
      url: 'https://hyperevmscan.io',
    },
  },
  contracts: {
    multicall3: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
    },
  },
});

export const hyperEvmChain = hyperEvm;

/**
 * Crucial: https://rpc.hyperliquid.xyz/evm rejects JSON-RPC HTTP batch arrays,
 * so we enable Multicall3 batching (`batch: { multicall: true }`) and disable HTTP batching.
 */
export const publicClient = createPublicClient({
  chain: hyperEvm,
  batch: {
    multicall: {
      batchSize: 1024,
      wait: 16,
    },
  },
  transport: http('https://rpc.hyperliquid.xyz/evm', {
    batch: false,
    retryCount: 2,
    timeout: 10_000,
  }),
});

export function getWalletClient() {
  if (typeof window === 'undefined' || !(window as unknown as { ethereum?: unknown }).ethereum) {
    return null;
  }
  return createWalletClient({
    chain: hyperEvm,
    transport: custom((window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum),
  });
}
