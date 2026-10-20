export const CONTRACTS = {
  Exchange: '0x6cd5661646289FB6E65EA5C032310fDEd797D0a2' as const,
  BatchExecutor: '0x233Ff29b239abc1D7748605dA9b205C3e008626E' as const,
  PriceOracle: '0xa9B4c7b7Ca5835652d81E25739c870D49F39cC2e' as const,
  SessionKeyManager: '0x8326Eb8896e358717f10502Ec73CE8D28E37B108' as const,
  DepositProxyFactory: '0x1629b7D46bef6E13FF754174FC9F32dEa309b38F' as const,
  PaperToken: '0xe40f17915DAa230324030003A197cdAEf2261C0e' as const,
  PaperStaking: '0xAAd6c7b0CC3014FC80FfEDAe0Ed7Ce5967b0F016' as const,
  PaperTokenomics: '0x75174549dbBD44497D31a47E2E2D7406408d63D9' as const,
  USDC: '0xb88339CB7199b77E23DB6E890353E22632Ba630f' as const,
  Timelock: '0xB915Fa41e824D6aA31BB833Ee81220C0F2c8EA0F' as const,
  Multisig: '0x696292762fD5AC3677a45EdBe54EAECE4194d1F6' as const,
};

export const PRECOMPILES = {
  BBO: '0x000000000000000000000000000000000000080e' as const,
  MARK: '0x0000000000000000000000000000000000000806' as const,
  ORACLE: '0x0000000000000000000000000000000000000807' as const,
};

export const EXCHANGE_ABI = [
  { type: 'function', name: 'treasury', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalBalances', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLockedMargin', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lpBankrollAvailable', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'sideBucket', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalQueued', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'queueHead', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nextPositionId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'stakerFeeAccumulator', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'devFeeAccumulator', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tradingPaused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'instrumentCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'balances', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'userQueueHead', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'queueNode',
    stateMutability: 'view',
    inputs: [{ name: 'nodeId', type: 'uint256' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'next', type: 'uint256' },
      { name: 'userNext', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getUserOpenPositionIds',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: 'posId', type: 'uint256' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'instrumentId', type: 'uint32' },
      { name: 'entryPrice', type: 'uint64' },
      { name: 'margin', type: 'uint128' },
      { name: 'leverage', type: 'uint16' },
      { name: 'openedAt', type: 'uint64' },
      { name: 'isLong', type: 'bool' },
      { name: 'fromQueued', type: 'bool' },
      { name: 'isOpen', type: 'bool' },
    ],
  },
  { type: 'function', name: 'harvest', stateMutability: 'nonpayable', inputs: [{ name: 'maxEntries', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'pushStakerFees', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'requestSweep', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }], outputs: [] },
  { type: 'function', name: 'finalizeSweep', stateMutability: 'nonpayable', inputs: [{ name: 'user', type: 'address' }], outputs: [] },
  { type: 'function', name: 'liquidate', stateMutability: 'nonpayable', inputs: [{ name: 'posId', type: 'uint256' }], outputs: [] },
] as const;

export const PAPER_TOKENOMICS_ABI = [
  { type: 'function', name: 'trackedLpUsd', stateMutability: 'view', inputs: [], outputs: [{ type: 'int256' }] },
  { type: 'function', name: 'tailProgressUsd', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'lpFlatThresholdUsd', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tailDecayScaleUsd', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'flatRate', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export const PAPER_STAKING_ABI = [
  { type: 'function', name: 'totalStaked', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'stakedBalance', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pendingReward', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accRewardPerShare', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'rewardReserve', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unallocatedRewards', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'STAKE_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'UNSTAKE_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'CLAIM_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
] as const;

export const PAPER_TOKEN_ABI = [
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const;

export const SESSION_KEY_MANAGER_ABI = [
  { type: 'function', name: 'sessionKeys', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }, { name: 'key', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'DOMAIN_SEPARATOR', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'OPEN_POSITION_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'CLOSE_TYPEHASH', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'revokeSessionKey', stateMutability: 'nonpayable', inputs: [{ name: 'sessionKey', type: 'address' }], outputs: [] },
] as const;

export const DEPOSIT_PROXY_FACTORY_ABI = [
  { type: 'function', name: 'computeProxyAddress', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'proxyOf', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'address' }] },
] as const;

export const CREATE2_DEPOSIT_PROXY_ABI = [
  {
    type: 'function',
    name: 'withdrawStuckToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

export const PAPERTRADE_CONTRACTS = CONTRACTS;
export const ERC20_ABI = PAPER_TOKEN_ABI;

