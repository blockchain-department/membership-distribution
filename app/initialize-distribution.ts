import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  deriveVaultAuthority,
  getProgram,
  getProvider,
  parseEnvInt,
  parseIsoToUnix,
  saveKeypair,
  wholeTokensToRaw,
  WalletWithPayer,
} from "./common";

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;
  const wallet = provider.wallet as WalletWithPayer;

  const mint = process.env.MINT;
  if (!mint) {
    throw new Error("Missing MINT env var");
  }

  const maxRecipients = 120;
  const totalWholeTokens = "250000";
  const expiryTs = 1775951999;
  const expiryIso = "2026-04-11T23:59:59Z";
  const distributionKeypairPath =
    process.env.DISTRIBUTION_KEYPAIR ?? "app/out/distribution-keypair.json";

  const mintAccount = await getMint(provider.connection, new PublicKey(mint));
  const totalCap = wholeTokensToRaw(totalWholeTokens, mintAccount.decimals);

  const distribution = Keypair.generate();
  const vaultAuthority = deriveVaultAuthority(
    distribution.publicKey,
    program.programId
  );
  const vault = getAssociatedTokenAddressSync(
    mintAccount.address,
    vaultAuthority,
    true
  );

  const signature = await program.methods
    .initializeDistribution(maxRecipients, totalCap, new BN(expiryTs))
    .accounts({
      distribution: distribution.publicKey,
      authority: wallet.publicKey,
      mint: mintAccount.address,
      vaultAuthority,
      vault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([distribution])
    .rpc();

  saveKeypair(distributionKeypairPath, distribution);

  console.log("initialize signature:", signature);
  console.log("program id:", program.programId.toBase58());
  console.log("distribution:", distribution.publicKey.toBase58());
  console.log("vault authority:", vaultAuthority.toBase58());
  console.log("vault:", vault.toBase58());
  console.log("mint decimals:", mintAccount.decimals);
  console.log("max recipients:", maxRecipients);
  console.log("total cap raw:", totalCap.toString());
  console.log("expiry UTC:", expiryIso);
  console.log("expiry unix:", expiryTs);
  console.log("saved distribution keypair:", distributionKeypairPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
