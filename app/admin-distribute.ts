import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveRecipientPda,
  deriveVaultAuthority,
  getProgram,
  getProvider,
  requireEnv,
  WalletWithPayer,
} from "./common";

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;
  const wallet = provider.wallet as WalletWithPayer;

  const distribution = new PublicKey(requireEnv("DISTRIBUTION"));
  const mint = new PublicKey(requireEnv("MINT"));
  const recipientWallet = new PublicKey(requireEnv("RECIPIENT"));

  const distributionState = await program.account.distributionState.fetch(
    distribution
  );
  const recipient = deriveRecipientPda(
    distribution,
    recipientWallet,
    program.programId
  );
  const vaultAuthority = deriveVaultAuthority(distribution, program.programId);
  const recipientTokenAccount = getAssociatedTokenAddressSync(
    mint,
    recipientWallet
  );

  const signature = await program.methods
    .adminDistribute()
    .accounts({
      distribution,
      recipient,
      authority: wallet.publicKey,
      recipientWallet,
      mint,
      vaultAuthority,
      vault: distributionState.vault,
      recipientTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log("admin distribute signature:", signature);
  console.log("distribution:", distribution.toBase58());
  console.log("recipient:", recipientWallet.toBase58());
  console.log("recipient state:", recipient.toBase58());
  console.log("recipient ATA:", recipientTokenAccount.toBase58());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
