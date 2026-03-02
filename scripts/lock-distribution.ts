import * as anchor from "@coral-xyz/anchor";
import { MembershipDistribution } from "../target/types/membership_distribution";
import fs from "fs";
import * as dotenv from "dotenv";
dotenv.config(); 
async function lockDistribution() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MembershipDistribution as anchor.Program<MembershipDistribution>;

  const distributionAddress = new anchor.web3.PublicKey(
    fs.readFileSync("distribution_address.txt", "utf8")
  );

  const tx = await program.methods
    .lockDistribution()
    .accountsStrict({
      distribution: distributionAddress,
      authority: provider.wallet.publicKey,
    })
    .rpc();

  console.log("Distribution locked:", tx);
}

lockDistribution().catch(console.error);