# Audit Requirement Traceability

## 1. Client Requirement (Original)

`Membership Token Distribution (120 wallets, expiry 04/11/2026)`

Build and deploy a membership token distribution contract for 120 wallets distributing a total of 250,000 tokens.

Implement membership validity rules with expiration on 04/11/2026 (for example, claims disabled after expiry and/or membership state invalidated).
Support recipient list + allocations, secure claim/transfer flow, and logging for each distribution.

Deliverables:

- Deployed program ID
- Initialization scripts
- Test transfers
- Handover documentation

## 2. Date Interpretation for Audit

The requirement string uses `04/11/2026` and also says `11th april`.
For audit clarity, this is interpreted as:

- Date: `April 11, 2026`
- Current on-chain constant timestamp: `1775890800`
- UTC conversion: `2026-04-11 07:00:00 UTC`


## 3. Authoritative Sources

Primary implementation files:

- Program: `programs/membership-distribution/src/lib.rs`
- Anchor config: `Anchor.toml`
- Ops scripts: `app/*.ts`
- Tests: `tests/membership-distribution.ts`
- Handover: `docs/HANDOVER.md`


## 4. Requirement-to-Implementation Matrix

### R1. Exactly 120 wallets and 250,000 token cap

Implementation evidence:

- Hard max recipients: `HARD_MAX_RECIPIENTS = 120`
- Hard total whole token cap: `CAMPAIGN_TOTAL_CAP_WHOLE = 250000`
- `initialize_distribution` enforces exact values at initialization.
- `register_recipient` prevents over-cap and over-count.
- `lock_distribution` enforces exact completion before lock.

Status: `Implemented`

### R2. Membership validity + expiry on April 11, 2026

Implementation evidence:

- Hard expiry timestamp: `CAMPAIGN_EXPIRY_TS = 1775890800`
- `assert_distribution_open` gates pre-expiry operations.
- `claim` and `admin_distribute` fail after expiry.
- `expire_distribution` sets explicit expired state once time passes.
- `withdraw_unclaimed` is only allowed after expiry.

Status: `Implemented`

### R3. Recipient list and allocation support

Implementation evidence:

- Recipient PDA model per `(distribution, wallet)` seed.
- Allocation stored per recipient in `RecipientState`.
- Aggregate allocation tracked in `DistributionState.total_allocated`.
- Locking requires allocation sum exactly equals total cap.
- `app/register-recipients.ts` validates recipient count and allocation sum before registration.

Status: `Implemented`

### R4. Secure claim/transfer flow

Implementation evidence:

- Authority constraints (`has_one = authority`) for admin actions.
- Recipient ownership constraints for self-claim.
- Mint and vault account constraints across CPI token transfers.
- Vault signer is PDA (`vault-authority`) with deterministic seeds.
- Double-claim prevention via `recipient.claimed` and active flags.

Status: `Implemented`

### R5. Logging for each distribution action

Implementation evidence:

Events emitted:

- `DistributionInitialized`
- `RecipientRegistered`
- `DistributionLocked`
- `VaultFunded`
- `ClaimProcessed`
- `RecipientInvalidated`
- `DistributionExpired`
- `UnclaimedWithdrawn`

Status: `Implemented`

### R6. Deliverables package

Implementation evidence:

- Deployed program identifier is defined in source via `declare_id!`.
- Initialization scripts exist in `app/initialize-distribution.ts` (and `scripts/initialize.ts` legacy path).
- Test transfer flows exist in scripts (`app/claim.ts`, `app/admin-distribute.ts`) and test suite.
- Handover documentation exists in `docs/HANDOVER.md` and this audit traceability file.

Status: `Implemented`

## 5. Audit Evidence Collection Checklist

Use this sequence to produce auditor evidence artifacts.

1. Build and test
   - `yarn install`
   - `anchor build`
   - `anchor test`
2. Initialize distribution
   - `MINT=<MINT_PUBKEY> yarn init:distribution`
   - Save output: tx signature, distribution pubkey, vault pubkey
3. Register recipients and lock
   - `DISTRIBUTION=<DISTRIBUTION_PUBKEY> RECIPIENTS_FILE=app/config/recipients.json AUTO_LOCK=true yarn register:recipients`
   - Save output: registration tx logs and lock tx
4. Fund vault
   - `DISTRIBUTION=<DISTRIBUTION_PUBKEY> MINT=<MINT_PUBKEY> yarn fund:distribution`
   - Save output: funding tx + vault balance
5. Execute transfer tests
   - Recipient claim: `DISTRIBUTION=<...> MINT=<...> CLAIMANT_KEYPAIR=<...> yarn claim`
   - Admin transfer: `DISTRIBUTION=<...> MINT=<...> RECIPIENT=<...> yarn admin:distribute`
   - Save output: tx signatures and recipient balances
6. Verify final on-chain state snapshot
   - `DISTRIBUTION=<DISTRIBUTION_PUBKEY> yarn verify:distribution`
   - Save JSON output as audit artifact

## 6. Pre-Audit Consistency Checks

Before external audit sign-off, confirm these values are aligned across all relevant files:

- Program ID in `lib.rs`, `Anchor.toml`, and script helpers.
- Expiry timestamp in contract constants and operational docs.
- Recipient count and cap constants in scripts/tests and contract.

This prevents false negatives during reproducibility checks.
