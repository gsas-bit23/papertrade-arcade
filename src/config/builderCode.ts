export interface BuilderCodeConfig {
  /**
   * Currently false while Papertrade Builder Codes are in "Coming Soon" (Phase 3).
   * Flip to true once the on-chain builder registration plumbing is finalized.
   */
  liveOnProtocol: boolean;
  phase3Live: boolean;
  enabled: boolean;
  stageTaggingInPayload: boolean;
  builderId: string;
  builderCode: string;
  builderAddress: `0x${string}`;
  revenueShareBps: number; // 100 bps = 1% of LP revenue carve (0 extra fee to user)
  feeShareBps: number;
}

export type BuilderCodeState = BuilderCodeConfig;

export const DEFAULT_BUILDER_CODE_STATE: BuilderCodeConfig = {
  liveOnProtocol: false,
  phase3Live: false,
  enabled: false,
  stageTaggingInPayload: false,
  builderId: 'PAPERTRADE_ARCADE_V1',
  builderCode: 'PAPERTRADE_ARCADE_V1',
  builderAddress: '0xA7CADE0000000000000000000000000000001000',
  revenueShareBps: 100, // 1% from LP revenue carve
  feeShareBps: 100,
};

