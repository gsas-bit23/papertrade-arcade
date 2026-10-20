# Audit and remediation — 2026-10-20

Scope: frontend source, signing/submission, wallet authorization, contract reads, pricing display, queue accounting, and dependency/build checks. This is not a smart-contract security audit or proof that the application has zero defects.

## Remediated findings

- Replaced sign-only trade/stake flows with schema-compatible submission and explicit acceptance/execution states; submissions disabled without an approved endpoint.
- Added close actions for the connected owner's open BTC/ETH positions.
- Required actual on-chain session authorization and sufficient expiry before each session signature; owner signatures for all staking operations.
- Kept session secrets in memory, migrated legacy persisted secrets to public revocation metadata, and preserved revocation state after failed transactions.
- Checked successful receipts for every direct transaction helper and handled rejected actions in the UI.
- Reset wallet state on account/network/disconnect events and guarded stale asynchronous submissions and session updates.
- Added persistent ambiguous-request guards and cross-tab serialization; no blind automatic retries.
- Corrected entry previews to BBO midpoint and ETH on-chain price scaling to 100.
- Removed fallback quotes from trade authorization; invalid/old account reads fail closed.
- Summed every user queue ticket, followed linked-list pointers, detected cycles, and bounded the executable subset.
- Preserved exact decimal amounts, full staking export fields, and uint256 position IDs.
- Separated historical candle data from live quote freshness and corrected timestamp spacing in charts.
- Removed unsupported builder attribution and fabricated settlement/mint claims.

## Verification

35 regression tests pass across authorization, signatures, amount precision, submission failures, persistence, concurrency, freshness, receipts, and queue accounting. TypeScript and production build pass. `npm audit` reports zero known dependency vulnerabilities. Read-only deployed contract checks passed for the inspected getters. A second source review found and corrected revocation account-switch handling and a pre-live chart percentage error; tests and build were rerun afterward.

## Outstanding integration and coverage limits

Production trading is not certified: an approved relayer, automated intent reconciliation, and end-to-end execution/settlement tests remain required. See INTEGRATION.md. No wallet transaction was sent, and no claim of browser-wide visual or live wallet end-to-end coverage is made. Contract parameter changes and integer rounding can differ from display estimates. The collateral address discrepancy must be resolved with the protocol before adding deposits. The build reports a roughly 597 kB main JavaScript chunk; this is a remaining performance optimization, not a build failure.

Default signed-submission behavior is disabled while these integration requirements are unmet. Direct maintenance transactions remain available with wallet confirmation. Unresolved request reconciliation is manual and must only occur after checking official account activity; clearing history does not invalidate a signature.
