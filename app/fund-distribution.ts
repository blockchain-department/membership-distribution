import BN from "bn.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getProgram, getProvider, requireEnv, WalletWithPayer } from "./common";

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;
  const wallet = provider.wallet as WalletWithPayer;

  const distribution = new PublicKey(requireEnv("DISTRIBUTION"));
  const mint = new PublicKey(requireEnv("MINT"));
  const explicitAmount = process.env.AMOUNT_RAW;
  const sourceOverride = process.env.SOURCE_TOKEN_ACCOUNT;

  const distributionState = await program.account.distributionState.fetch(
    distribution
  );
  if (!distributionState.isLocked) {
    throw new Error("Distribution must be locked before funding");
  }

  const vault = distributionState.vault as PublicKey;
  const vaultAccount = await getAccount(provider.connection, vault);

  const amount = explicitAmount
    ? new BN(explicitAmount)
    : distributionState.totalCap.sub(new BN(vaultAccount.amount.toString()));
  if (amount.lte(new BN(0))) {
    throw new Error("Nothing to fund. Vault already has enough tokens.");
  }

  const sourceTokenAccount = sourceOverride
    ? new PublicKey(sourceOverride)
    : getAssociatedTokenAddressSync(mint, wallet.publicKey);

  const signature = await program.methods
    .fundVault(amount)
    .accounts({
      distribution,
      authority: wallet.publicKey,
      mint,
      sourceTokenAccount,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("fund signature:", signature);
  console.log("distribution:", distribution.toBase58());
  console.log("vault:", vault.toBase58());
  console.log("amount raw:", amount.toString());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
