import * as anchor from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import fs from "fs";
import bs58 from "bs58";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import * as dotenv from "dotenv";
dotenv.config(); 

async function claimWithPrivateKey() {
  // Load private key from environment variable
  const secretKeyBase58 = process.env.SECOND_RECIPIENT_PRIVATE_KEY;
  if (!secretKeyBase58) {
    throw new Error("RECIPIENT_SECRET_KEY environment variable is not set");
  }

  const secretKey = bs58.decode(secretKeyBase58);
  const claimantKeypair = anchor.web3.Keypair.fromSecretKey(secretKey);

  const connection = new anchor.web3.Connection(anchor.web3.clusterApiUrl("devnet"));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(claimantKeypair), {});
  anchor.setProvider(provider);

  const program = anchor.workspace.MembershipDistribution as anchor.Program<MembershipDistribution>;

  const distributionAddress = new anchor.web3.PublicKey(fs.readFileSync("distribution_address.txt", "utf8"));
  const distribution = await program.account.distributionState.fetch(distributionAddress);

  // Derive recipient PDA
  const [recipientPDA] = await anchor.web3.PublicKey.findProgramAddress(
    [
      Buffer.from("recipient"),
      distributionAddress.toBuffer(),
      claimantKeypair.publicKey.toBuffer()
    ],
    program.programId
  );

  // Derive vault authority PDA (matches Rust seed exactly)
  const [vaultAuthority] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("vault-authority"), distributionAddress.toBuffer()],
    program.programId
  );

  const claimantTokenAccount = await getAssociatedTokenAddress(distribution.mint, claimantKeypair.publicKey);

  const tx = await program.methods
    .claim()
    .accountsStrict({
      distribution: distributionAddress,
      recipient: recipientPDA,
      claimant: claimantKeypair.publicKey,
      mint: distribution.mint,
      vaultAuthority,
      vault: distribution.vault,
      claimantTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Claim transaction signature:", tx);
}

claimWithPrivateKey().catch(console.error);