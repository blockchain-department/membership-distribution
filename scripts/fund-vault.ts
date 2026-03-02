import * as anchor from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

async function fundVault(amount: number) {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program =
    anchor.workspace.MembershipDistribution as anchor.Program<MembershipDistribution>;

  const distributionAddress = new anchor.web3.PublicKey(
    fs.readFileSync("distribution_address.txt", "utf8").trim()
  );

  const distribution =
    await program.account.distributionState.fetch(distributionAddress);

  const mint = distribution.mint;
  const vault = distribution.vault;

  // Automatically derive admin ATA
  const sourceTokenAccount = getAssociatedTokenAddressSync(
    mint,
    provider.wallet.publicKey
  );

  console.log("Cluster:", provider.connection.rpcEndpoint);
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Source ATA:", sourceTokenAccount.toBase58());
  console.log("Vault ATA:", vault.toBase58());

  const tx = await program.methods
    .fundVault(new anchor.BN(amount))
    .accountsStrict({
      distribution: distributionAddress,
      authority: provider.wallet.publicKey,
      mint,
      sourceTokenAccount,
      vault,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("Vault funded successfully:", tx);
}

// Example call
fundVault(250000000000).catch(console.error);