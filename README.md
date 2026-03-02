# Membership Token Distribution (Anchor 0.32.1)

Production-ready Solana/Anchor program for membership token distribution with:

- **Strict Enforcement:** Exact 120 recipients, 250,000 tokens, and April 11, 2026 expiry hard-coded in contract logic.
- Configurable per-wallet allocations (must sum to 250k)
- Expiry-gated claims/transfers
- Event logging for initialization, funding, claims, invalidations, expiry, and withdrawals

Program ID (configured in `declare_id!` and `Anchor.toml`):

- `54MDjjmV8xPhsgW2R2rKXVmTogyph6TJ5VKUcKgB7TYm`

## Campaign Parameters (requested)

- Recipients: `120`
- Total tokens: `250,000`
- Expiry date: **April 11, 2026**
- Canonical UTC expiry for scripts: `2026-04-11T23:59:59Z`

## Contract Features

- Recipient list registration with exact allocation tracking
- Distribution lock before funding/claims
- Vault-based SPL token transfers via PDA signer
- Recipient self-claim (`claim`)
- Admin-assisted transfer (`admin_distribute`)
- Expiry enforcement (`claims disabled after expiry`)
- Explicit expiry state invalidation (`expire_distribution`)
- Post-expiry unclaimed token withdrawal (`withdraw_unclaimed`)
- Structured on-chain events for operational audit logs

## Project Layout

- Program: `programs/membership-distribution/src/lib.rs`
- Tests: `tests/membership-distribution.ts`
- Ops scripts:
  - `app/initialize-distribution.ts`
  - `app/register-recipients.ts`
  - `app/fund-distribution.ts`
  - `app/claim.ts`
  - `app/admin-distribute.ts`
  - `app/verify-distribution.ts`
  - `app/common.ts`

## Build and Test

Prerequisites:

- Anchor CLI `0.32.1`
- Solana CLI
- Rust toolchain (see `rust-toolchain.toml`)
- Node + Yarn

Commands:

```bash
yarn install
anchor build
anchor test
```

## Initialization and Distribution Runbook

See full handover: `docs/HANDOVER.md`
See client requirement audit traceability: `docs/AUDIT_REQUIREMENTS.md`

Quick sequence:

```bash
# 1) Initialize campaign
MINT=<MINT_PUBKEY> \
MAX_RECIPIENTS=120 \
TOTAL_WHOLE_TOKENS=250000 \
EXPIRY_UTC=2026-04-11T23:59:59Z \
yarn init:distribution

# 2) Register recipients from JSON and lock
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
RECIPIENTS_FILE=app/config/recipients.json \
AUTO_LOCK=true \
yarn register:recipients

# 3) Fund vault
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
yarn fund:distribution

# 4a) Recipient claim
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
CLAIMANT_KEYPAIR=<PATH_TO_CLAIMANT_KEYPAIR_JSON> \
yarn claim

# 4b) Admin transfer to recipient
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
RECIPIENT=<RECIPIENT_PUBKEY> \
yarn admin:distribute
```
