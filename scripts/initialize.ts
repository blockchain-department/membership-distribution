import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import {
  getMint,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();
async function main() {
  // Provider from Anchor.toml (cluster + wallet auto loaded)
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .MembershipDistribution as Program<MembershipDistribution>;

  console.log("Cluster:", provider.connection.rpcEndpoint);
  console.log("Authority:", provider.wallet.publicKey.toBase58());

  // =============================
  // CAMPAIGN CONSTANTS (MUST MATCH RUST)
  // =============================
  const HARD_MAX_RECIPIENTS =120;
  const CAMPAIGN_TOTAL_CAP_WHOLE = 250000;
  const CAMPAIGN_EXPIRY_TS = new anchor.BN(1775890800);

  // =============================
  // CONFIGURE YOUR MINT HERE
  // =============================
  const MINT_ADDRESS = new PublicKey(process.env.MINT_ADDRESS!);

  // =============================
  // CREATE DISTRIBUTION ACCOUNT
  // =============================
  const distributionKeypair = anchor.web3.Keypair.generate();
  console.log(
    "New Distribution Account:",
    distributionKeypair.publicKey.toBase58()
  );

  // =============================
  // DERIVE VAULT AUTHORITY PDA
  // =============================
  const [vaultAuthorityPda, vaultAuthorityBump] =
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault-authority"),
        distributionKeypair.publicKey.toBuffer(),
      ],
      program.programId
    );

  console.log("Vault Authority PDA:", vaultAuthorityPda.toBase58());
  console.log("Vault Authority Bump:", vaultAuthorityBump);

  // =============================
  // DERIVE VAULT ATA
  // =============================
  const vaultAta = getAssociatedTokenAddressSync(
    MINT_ADDRESS,
    vaultAuthorityPda,
    true
  );

  console.log("Vault ATA:", vaultAta.toBase58());

  // =============================
  // FETCH MINT DECIMALS
  // =============================
  const mintInfo = await getMint(
    provider.connection,
    MINT_ADDRESS
  );

  const totalCapWithDecimals = new anchor.BN(
    CAMPAIGN_TOTAL_CAP_WHOLE
  ).mul(
    new anchor.BN(10).pow(new anchor.BN(mintInfo.decimals))
  );

  console.log("Mint Decimals:", mintInfo.decimals);
  console.log("Total Cap With Decimals:", totalCapWithDecimals.toString());

  // =============================
  // SEND TRANSACTION
  // =============================
  const tx = await program.methods
    .initializeDistribution(
      HARD_MAX_RECIPIENTS,
      totalCapWithDecimals,
      CAMPAIGN_EXPIRY_TS
    )
    .accountsStrict({
      distribution: distributionKeypair.publicKey,
      authority: provider.wallet.publicKey,
      mint: MINT_ADDRESS,
      vaultAuthority: vaultAuthorityPda,
      vault: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([distributionKeypair])
    .rpc();

  console.log("Initialization Success");
  console.log("Transaction Signature:", tx);

  // Save distribution address for next scripts
  fs.writeFileSync(
    "distribution_address.txt",
    distributionKeypair.publicKey.toBase58()
  );

  console.log("Distribution address saved to distribution_address.txt");
}

main().catch((err) => {
  console.error("Initialization Failed");
  console.error(err);
});