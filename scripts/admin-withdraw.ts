import * as anchor from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import fs from "fs";
import bs58 from "bs58";
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress 
} from "@solana/spl-token";
import * as dotenv from "dotenv";
dotenv.config();
async function adminWithdraw() {
  // 🔹 Load admin private key from env
  const secretKeyBase58 = process.env.ADMIN_SECRET_KEY;
  if (!secretKeyBase58) {
    throw new Error("ADMIN_SECRET_KEY environment variable not set");
  }

  const secretKey = bs58.decode(secretKeyBase58);
  const adminKeypair = anchor.web3.Keypair.fromSecretKey(secretKey);

  const connection = new anchor.web3.Connection(
    anchor.web3.clusterApiUrl("devnet")
  );

  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(adminKeypair),
    {}
  );

  anchor.setProvider(provider);

  const program = anchor.workspace
    .MembershipDistribution as anchor.Program<MembershipDistribution>;

  // 🔹 Load distribution address
  const distributionAddress = new anchor.web3.PublicKey(
    fs.readFileSync("distribution_address.txt", "utf8")
  );

  const distribution =
    await program.account.distributionState.fetch(distributionAddress);

  // 🔹 Derive vault authority PDA
  const [vaultAuthority] =
    await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("vault-authority"), distributionAddress.toBuffer()],
      program.programId
    );

  // 🔹 Admin destination ATA
  const destinationTokenAccount = await getAssociatedTokenAddress(
    distribution.mint,
    adminKeypair.publicKey
  );

  // 🔹 Amount to withdraw (example: withdraw full vault balance)
  const vaultBalance = distribution.vault;
  const vaultAccount = await connection.getTokenAccountBalance(vaultBalance);
  const amount = new anchor.BN(vaultAccount.value.amount);

  console.log("Withdrawing amount:", amount.toString());

  const tx = await program.methods
    .withdrawUnclaimed(amount)
    .accountsStrict({
      distribution: distributionAddress,
      authority: adminKeypair.publicKey,
      mint: distribution.mint,
      vaultAuthority,
      vault: distribution.vault,
      destinationTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  console.log("Withdraw transaction signature:", tx);
}

adminWithdraw().catch(console.error);