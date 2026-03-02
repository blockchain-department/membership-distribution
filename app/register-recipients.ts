import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { readFileSync } from "fs";
import {
  deriveRecipientPda,
  getProgram,
  getProvider,
  requireEnv,
  WalletWithPayer,
} from "./common";

type RecipientInput = {
  wallet: string;
  allocation: string | number;
};

type RecipientsFile = {
  recipients: RecipientInput[];
};

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;
  const wallet = provider.wallet as WalletWithPayer;

  const distribution = new PublicKey(requireEnv("DISTRIBUTION"));
  const recipientsFilePath =
    process.env.RECIPIENTS_FILE ?? "app/config/recipients.json";
  const autoLock = process.env.AUTO_LOCK === "true";

  const distributionState = await program.account.distributionState.fetch(
    distribution
  );
  const fileData = JSON.parse(
    readFileSync(recipientsFilePath, "utf-8")
  ) as RecipientsFile;
  const recipients = fileData.recipients ?? [];

  if (recipients.length !== distributionState.maxRecipients) {
    throw new Error(
      `Expected ${distributionState.maxRecipients} recipients, got ${recipients.length}`
    );
  }

  const seen = new Set<string>();
  let totalAllocations = new BN(0);
  for (const entry of recipients) {
    if (seen.has(entry.wallet)) {
      throw new Error(`Duplicate wallet in recipient file: ${entry.wallet}`);
    }
    seen.add(entry.wallet);
    totalAllocations = totalAllocations.add(
      new BN(entry.allocation.toString())
    );
  }

  if (!totalAllocations.eq(distributionState.totalCap)) {
    throw new Error(
      `Allocation sum mismatch. expected=${distributionState.totalCap.toString()} actual=${totalAllocations.toString()}`
    );
  }

  for (let i = 0; i < recipients.length; i += 1) {
    const recipientWallet = new PublicKey(recipients[i].wallet);
    const allocation = new BN(recipients[i].allocation.toString());
    const recipient = deriveRecipientPda(
      distribution,
      recipientWallet,
      program.programId
    );

    const accountInfo = await provider.connection.getAccountInfo(recipient);
    if (accountInfo) {
      console.log(
        `[${i + 1}/${
          recipients.length
        }] skip existing recipient ${recipientWallet.toBase58()}`
      );
      continue;
    }

    const signature = await program.methods
      .registerRecipient(recipientWallet, allocation)
      .accounts({
        distribution,
        recipient,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(
      `[${i + 1}/${
        recipients.length
      }] registered ${recipientWallet.toBase58()} allocation=${allocation.toString()} tx=${signature}`
    );
  }

  const refreshed = await program.account.distributionState.fetch(distribution);
  console.log("registered recipients:", refreshed.totalRecipients);
  console.log("total allocated raw:", refreshed.totalAllocated.toString());

  if (autoLock && !refreshed.isLocked) {
    const lockSig = await program.methods
      .lockDistribution()
      .accounts({
        distribution,
        authority: wallet.publicKey,
      })
      .rpc();
    console.log("lock signature:", lockSig);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
