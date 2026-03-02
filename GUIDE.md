# 📖 Membership Distribution Program - User Guide

## 🚀 Initial Setup

### Building and Deploying

1. **Clean and Build**
```bash
anchor clean
```

2. **Build the program**
```bash
anchor build
```

3. **Deploy to Devnet**
```bash
anchor deploy --provider.cluster https://api.devnet.solana.com
```

#### Environment Variables:
```env
# Your token mint address (create one first if needed)
MINT_ADDRESS=YourTokenMintAddressHere

# Admin private key (base58 format) for withdrawal
ADMIN_SECRET_KEY=YourAdminPrivateKeyBase58Here

# Recipient private keys (base58 format) for testing claims
RECIPIENT_SECRET_KEY=YourRecipientPrivateKeyBase58Here
```

## 📋 Distribution Flow

### Step 1: Initialize Distribution

Before running the script, ensure the expiry timestamp in `lib.rs` and `initialize.ts` matches, ANCHOR_PROVIDER_URL & ANCHOR_WALLET.

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=/home/shoaibmk/.config/solana/id.json
npx ts-node scripts/initialize.ts
```


### Step 2: Register Recipients

```bash
npx ts-node scripts/register-recipients.ts
```


### Step 3: Lock Distribution

```bash
npx ts-node scripts/lock-distribution.ts
```

### Step 4: Fund the Vault

```bash
npx ts-node scripts/fund-vault.ts
```

### Step 5: Claim Tokens (as Recipient)

To claim, you need the recipient's private key. Set it in `.env`:

```env
RECIPIENT_SECRET_KEY=Base58EncodedRecipientPrivateKey
```

Update `scripts/claim.ts`:

```typescript
const secretKeyBase58 = process.env.RECIPIENT_SECRET_KEY;
```

Then run:

```bash
npx ts-node scripts/claim.ts
```


### Step 6: Withdraw Unclaimed Tokens (After Expiry)

```bash
npx ts-node scripts/withdraw-unclaimed.ts
```

