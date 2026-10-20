# Integration status — 2026-10-20

## Release gate

Verification of relayer access from this frontend and end-to-end settlement validation remain outstanding. The default build disables trading, registration, and staking submissions. Direct wallet maintenance actions still require current account data and explicit wallet confirmation. No live transaction was signed or broadcast during this audit.

The protocol architecture restricts opens/closes to its authorized relayer/BatchExecutor. The official `/intents` endpoint rejected a cross-origin browser preflight from localhost (405 without an allow-origin header). That observation alone does not establish a frontend whitelist or approval requirement. Verify the current endpoint and CORS behavior from the actual deployed origin, plus the intent status/reconciliation API. Do not assume builder-code eligibility is required for basic signed-intent submission. There is no automatic settlement polling in this version; ambiguous outcomes remain blocked until the user verifies official activity.

Before enabling a relayer, validate registration, owner and session open/close, stake/unstake/claim, replay protection, nonce handling, deadline expiry, rejection, delayed confirmation, and reconciliation with on-chain execution. Test account/network changes and browser reloads during every stage. Confirm supported collateral and deployment addresses with the protocol: the published frontend and older documentation disagree on the collateral token address. This app does not initiate token deposits.

## Signing compatibility

Interoperability fields were checked against the public official frontend's `typed-data-B0hqt2-N.js`, `app-DsuefDBF.js`, and deployment configuration on the audit date. They are implemented in `protocolIntents.ts`.

Trading/session domain: `String`, version `1`, chain `999`, Exchange verifying contract. Staking domain: `PaperStaking`, version `1`, chain `999`, PaperStaking verifying contract. Registration includes `user,key,expiry,feeAddress,nonce,deadline`. Opens include `user,instrumentId,isLong,size,leverage,useDebt,nonce,deadline`. Closes include `user,positionIds,nonce,deadline`. Stake/unstake include `user,amount,nonce,deadline`; claim omits amount.

POST `/intents` uses `{action,signed}` with decimal strings for integers and `r,s,v`. The acknowledgement must match intent ID and action and contain a numeric string queue revision and a recognized state. The intent ID binds the `papertrade:intent-id:v2` hash, typed-data digest, and signer. Random 128-bit nonces target the unordered nonce space; compatibility still requires live integration validation.

## Sources

- https://docs.papertrade.xyz/how/architecture/
- https://docs.papertrade.xyz/learn/session-keys/
- https://docs.papertrade.xyz/how/pricing-bbo/
- https://docs.papertrade.xyz/how/asymmetric-impact/
- https://docs.papertrade.xyz/how/builder-codes/
- https://exchange.papertrade.xyz/

Read-only RPC verification succeeded for the configured Exchange, PaperTokenomics, PaperStaking, SessionKeyManager, and DepositProxyFactory getters used in the audit. ETH entry price scaling is 100; BTC is 10. Read success does not validate transaction execution or settlement formulas.

## Verification procedure for the next integration pass

1. Read the current official FAQ and frontend client to identify the exact public read routes, POST submission route, status lookup, and wallet SSE route. Do not guess a status URL or infer its schema from the submission acknowledgement.
2. Record request/response fixtures for public reads and status responses, including identifiers, state, transaction hash, error fields, and revision ordering. Use only public data; never commit signed user requests, secrets, or session keys.
3. Test the actual deployed origin's preflight with POST and Content-Type request headers. Record status and allow-origin/method/header values. Localhost failure alone does not decide deployed-origin access. A successful public GET does not establish permission to POST.
4. Verify current EIP-712 domains, field types, nonce semantics, deadlines, and supported actions against official client behavior. Existing schemas are audit-date observations, not a versioned API contract.
5. Implement bounded status polling or SSE with reconnect, reload recovery, and account isolation. Match intent ID and user; distinguish relayer confirmation from independently verified chain execution. A missing/late status response must not trigger an automatic resubmission.
6. For a confirmed result, verify the matching transaction receipt and action-specific events or state. A balance change alone cannot identify which concurrent action settled. Document confirmation/finality handling and reconcile receipt failure or reorgs.
7. Add regression tests for mismatched IDs, malformed payloads, out-of-order updates, timeout after acceptance, expired signatures, duplicate requests, revoked sessions, and account changes. Run tests and the production build before enabling submissions.
8. Perform controlled end-to-end tests in an available staging environment, then explicitly authorized minimal-value live tests if needed. Do not claim settlement coverage from mocked tests or HTTP success.

### Follow-up status

The follow-up could access GitHub but had no usable execution environment; the web reader could not retrieve the official FAQ or JavaScript client. No new endpoint, CORS, status-schema, or live settlement verification was completed. This documentation correction removes the unsupported frontend-approval requirement; it does not enable trading or certify the integration. The FAQ supplied for the follow-up is https://docs.papertrade.xyz/intro/faq/.
