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
  loadKeypair,
  requireEnv,
} from "./common";

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;

  const distribution = new PublicKey(requireEnv("DISTRIBUTION"));
  const mint = new PublicKey(requireEnv("MINT"));
  const claimantKeypairPath = requireEnv("CLAIMANT_KEYPAIR");
  const claimant = loadKeypair(claimantKeypairPath);

  const distributionState = await program.account.distributionState.fetch(
    distribution
  );
  const recipient = deriveRecipientPda(
    distribution,
    claimant.publicKey,
    program.programId
  );
  const vaultAuthority = deriveVaultAuthority(distribution, program.programId);
  const claimantTokenAccount = getAssociatedTokenAddressSync(
    mint,
    claimant.publicKey
  );

  const signature = await program.methods
    .claim()
    .accounts({
      distribution,
      recipient,
      claimant: claimant.publicKey,
      mint,
      vaultAuthority,
      vault: distributionState.vault,
      claimantTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([claimant])
    .rpc();

  console.log("claim signature:", signature);
  console.log("distribution:", distribution.toBase58());
  console.log("claimant:", claimant.publicKey.toBase58());
  console.log("recipient state:", recipient.toBase58());
  console.log("claimant ATA:", claimantTokenAccount.toBase58());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
