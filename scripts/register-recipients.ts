import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .MembershipDistribution as Program<MembershipDistribution>;

  // Load distribution address
  const distributionAddress = new PublicKey(
    fs.readFileSync("distribution_address.txt", "utf-8")
  );

  // Load recipients.json
  const recipientsData = JSON.parse(
    fs.readFileSync("recipients.json", "utf-8")
  );

  const decimals = recipientsData.decimals;
  const recipients = recipientsData.recipients;

  for (let i = 0; i < recipients.length; i++) {
    const walletString = recipients[i].wallet;
    const amountWhole = recipients[i].amount;

    const recipientWallet = new PublicKey(walletString);

    // Convert whole token amount to smallest unit
    const allocation = new anchor.BN(amountWhole).mul(
      new anchor.BN(10).pow(new anchor.BN(decimals))
    );

    // Derive recipient PDA
    const [recipientPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("recipient"),
        distributionAddress.toBuffer(),
        recipientWallet.toBuffer(),
      ],
      program.programId
    );

    console.log(`Registering recipient ${i + 1}`);
    console.log("Wallet:", recipientWallet.toBase58());
    console.log("Allocation smallest unit:", allocation.toString());

    try {
      const tx = await program.methods
        .registerRecipient(recipientWallet, allocation)
        .accountsStrict({
          distribution: distributionAddress,
          recipient: recipientPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`✅ Recipient ${i + 1} registered`);
      console.log("Tx:", tx);
    } catch (err) {
      console.error(`❌ Failed recipient ${i + 1}`);
      console.error(err);
    }

    console.log("----------------------------------");
  }
}

main().catch((err) => {
  console.error("Script failed");
  console.error(err);
});