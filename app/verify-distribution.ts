import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { getProgram, getProvider, requireEnv } from "./common";

async function main() {
  const provider = getProvider();
  const program = getProgram(provider) as any;
  const distribution = new PublicKey(requireEnv("DISTRIBUTION"));

  const state = await program.account.distributionState.fetch(distribution);
  const vaultAccount = await getAccount(provider.connection, state.vault);

  console.log(
    JSON.stringify(
      {
        programId: program.programId.toBase58(),
        distribution: distribution.toBase58(),
        authority: state.authority.toBase58(),
        mint: state.mint.toBase58(),
        vault: state.vault.toBase58(),
        vaultBalanceRaw: vaultAccount.amount.toString(),
        isLocked: state.isLocked,
        isExpired: state.isExpired,
        maxRecipients: state.maxRecipients,
        totalRecipients: state.totalRecipients,
        claimedRecipients: state.claimedRecipients,
        totalCapRaw: state.totalCap.toString(),
        totalAllocatedRaw: state.totalAllocated.toString(),
        totalDistributedRaw: state.totalDistributed.toString(),
        expiryTs: state.expiryTs.toString(),
        createdAt: state.createdAt.toString(),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
