# Integration status — 2026-10-20

## Release gate

An authorized relayer and end-to-end settlement validation remain outstanding. The default build disables trading, registration, and staking submissions. Direct wallet maintenance actions still require current account data and explicit wallet confirmation. No live transaction was signed or broadcast during this audit.

The protocol architecture restricts opens/closes to its authorized relayer/BatchExecutor. The official `/intents` endpoint rejected a cross-origin browser preflight from localhost (405 without an allow-origin header). This project does not bypass that restriction. A deployment needs a protocol-approved endpoint accepting its actual origin, plus a verified intent status/reconciliation API. There is no automatic settlement polling in this version; ambiguous outcomes remain blocked until the user verifies official activity.

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
