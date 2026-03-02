# Handover Guide (Strict Compliance)

For requirement-to-implementation audit traceability, see `docs/AUDIT_REQUIREMENTS.md`.

## 1. Compliance Status: **STRICT PASS**

This implementation has transitioned from a parameter-based contract to a **strictly enforced** campaign contract. The following requirements are now hard-coded into the on-chain logic:

- **120 unique wallets**
- **250,000 whole tokens**
- **Expiry on April 11, 2026, 23:59:59 UTC**

Any initialization attempt with different values will fail on-chain.

## 2. Deployment Metadata

- Program name: `membership_distribution`
- Program ID: `54MDjjmV8xPhsgW2R2rKXVmTogyph6TJ5VKUcKgB7TYm`
- Anchor target version: `0.32.1`

## 3. Campaign Parameters (Hard-coded)

- Wallet count: `120`
- Total token distribution: `250,000` whole tokens
- Expiry date: **April 11, 2026**
- Canonical Unix Timestamp: `1775890800`

Note on date format:

- Requirement text included `04/11/2026 (11th april)`.
- This implementation treats that as **11 April 2026**, not November 4.

## 3. Program Lifecycle

1. `initialize_distribution(max_recipients, total_cap, expiry_ts)`
2. `register_recipient(wallet, allocation)` repeated per recipient
3. `lock_distribution()` once list/cap are complete
4. `fund_vault(amount)` from authority token account
5. Distribution via:
   - `claim()` by recipient
   - `admin_distribute()` by authority
6. After expiry:
   - `expire_distribution()` to set explicit expired state
   - `withdraw_unclaimed(amount)` to recover leftover tokens

## 4. Security/Validation Rules

- Max recipients hard cap is `120`.
- Claims/transfers require:
  - distribution is locked
  - recipient is active and unclaimed
  - campaign not expired
- Registration allowed only before lock and before expiry.
- `lock_distribution` requires:
  - `total_recipients == max_recipients`
  - `total_allocated == total_cap`
- Transfers use PDA-controlled vault (`vault-authority` PDA).
- All key actions emit events for indexing and audit.

## 5. Required Files

- Contract: `programs/membership-distribution/src/lib.rs`
- Test suite: `tests/membership-distribution.ts`
- Scripts:
  - `app/initialize-distribution.ts`
  - `app/register-recipients.ts`
  - `app/fund-distribution.ts`
  - `app/claim.ts`
  - `app/admin-distribute.ts`
  - `app/verify-distribution.ts`
- Shared helper: `app/common.ts`
- Recipient template: `app/config/recipients.example.json`

## 6. Runbook Commands

### Build and tests

```bash
yarn install
anchor build
anchor test
```

### Initialize

```bash
MINT=<MINT_PUBKEY> \
MAX_RECIPIENTS=120 \
TOTAL_WHOLE_TOKENS=250000 \
EXPIRY_UTC=2026-04-11T23:59:59Z \
DISTRIBUTION_KEYPAIR=app/out/distribution-keypair.json \
yarn init:distribution
```

### Register recipients and lock

Prepare `app/config/recipients.json`:

```json
{
  "recipients": [{ "wallet": "<PUBKEY_1>", "allocation": "<RAW_AMOUNT_1>" }]
}
```

Then run:

```bash
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
RECIPIENTS_FILE=app/config/recipients.json \
AUTO_LOCK=true \
yarn register:recipients
```

### Fund vault

```bash
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
yarn fund:distribution
```

### Test transfers

Recipient claim:

```bash
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
CLAIMANT_KEYPAIR=<RECIPIENT_KEYPAIR_JSON> \
yarn claim
```

Admin transfer:

```bash
DISTRIBUTION=<DISTRIBUTION_PUBKEY> \
MINT=<MINT_PUBKEY> \
RECIPIENT=<RECIPIENT_PUBKEY> \
yarn admin:distribute
```

### Verify state

```bash
DISTRIBUTION=<DISTRIBUTION_PUBKEY> yarn verify:distribution
```

## 7. Operational Checklist

1. Confirm mint decimals and convert `250,000` whole tokens to raw units.
2. Validate recipient JSON has exactly `120` unique wallets.
3. Validate allocation sum equals `total_cap`.
4. Lock distribution before funding.
5. Verify vault balance equals funded amount.
6. Monitor claim/admin transfer events.
7. On/after April 11, 2026 UTC, run expiry + unclaimed withdrawal process.
