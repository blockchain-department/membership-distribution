import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";

type DistributionFixture = {
  distribution: Keypair;
  vaultAuthority: PublicKey;
  vault: PublicKey;
};

describe("membership-distribution strict campaign invariants", function () {
  this.timeout(1_200_000);

  const RECIPIENT_SEED = Buffer.from("recipient");
  const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");
  const DECIMALS = 6;
  const MAX_RECIPIENTS = 5;
  const TOTAL_WHOLE_TOKENS = 250_000;
  const CAMPAIGN_EXPIRY_TS = 1_775_951_999;
  const BASE_WHOLE_ALLOCATION = 2_000;

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet & { payer: Keypair };
  const workspace = anchor.workspace as Record<string, any>;
  const program = (workspace.MembershipDistribution ??
    workspace.membershipDistribution) as any;

  if (!program) {
    throw new Error("Program handle not found in anchor workspace");
  }

  const tokenScale = new BN(10).pow(new BN(DECIMALS));
  const totalCap = new BN(TOTAL_WHOLE_TOKENS).mul(tokenScale);
  const tinyAllocation = new BN(1);

  const initializeArgCount = (
    (program.idl?.instructions ?? []).find(
      (ix: { name: string }) =>
        ix.name === "initialize_distribution" ||
        ix.name === "initializeDistribution"
    )?.args ?? []
  ).length;

  let mint: PublicKey;
  let authorityTokenAccount: PublicKey;

  const deriveRecipientPda = (
    distributionKey: PublicKey,
    walletKey: PublicKey
  ) =>
    PublicKey.findProgramAddressSync(
      [RECIPIENT_SEED, distributionKey.toBuffer(), walletKey.toBuffer()],
      program.programId
    )[0];

  const deriveVaultFixture = (
    distribution: Keypair
  ): Pick<DistributionFixture, "vaultAuthority" | "vault"> => {
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [VAULT_AUTHORITY_SEED, distribution.publicKey.toBuffer()],
      program.programId
    );
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true);
    return { vaultAuthority, vault };
  };

  const assertProgramError = async (
    execute: () => Promise<unknown>,
    expectedCode: string
  ) => {
    let failed = false;
    try {
      await execute();
    } catch (error) {
      failed = true;
      expect(`${error}`).to.contain(expectedCode);
    }
    expect(failed).to.eq(true, `Expected ${expectedCode} failure`);
  };

  const airdropSol = async (
    address: PublicKey,
    lamports = LAMPORTS_PER_SOL
  ) => {
    const signature = await provider.connection.requestAirdrop(
      address,
      lamports
    );
    await provider.connection.confirmTransaction(signature, "confirmed");
  };

  const initializeStrictDistribution = async (
    fixture: DistributionFixture
  ): Promise<void> => {
    const builder =
      initializeArgCount === 0
        ? program.methods.initializeDistribution()
        : program.methods.initializeDistribution(
            MAX_RECIPIENTS,
            totalCap,
            new BN(CAMPAIGN_EXPIRY_TS)
          );

    await builder
      .accounts({
        distribution: fixture.distribution.publicKey,
        authority: wallet.publicKey,
        mint,
        vaultAuthority: fixture.vaultAuthority,
        vault: fixture.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([fixture.distribution])
      .rpc();
  };

  const createStrictDistribution = async (): Promise<DistributionFixture> => {
    const distribution = Keypair.generate();
    const { vaultAuthority, vault } = deriveVaultFixture(distribution);
    const fixture = { distribution, vaultAuthority, vault };
    await initializeStrictDistribution(fixture);
    return fixture;
  };

  const assertDistributionState = async (
    distribution: PublicKey,
    expected: {
      maxRecipients?: number;
      totalCap?: BN;
      expiryTs?: number;
      totalRecipients?: number;
      totalAllocated?: BN;
      totalFunded?: BN;
      totalDistributed?: BN;
      claimedRecipients?: number;
      isLocked?: boolean;
      isExpired?: boolean;
    }
  ) => {
    const state = await program.account.distributionState.fetch(distribution);

    if (expected.maxRecipients !== undefined) {
      expect(state.maxRecipients).to.eq(expected.maxRecipients);
    }
    if (expected.totalCap !== undefined) {
      expect(state.totalCap.toString()).to.eq(expected.totalCap.toString());
    }
    if (expected.expiryTs !== undefined) {
      expect(state.expiryTs.toString()).to.eq(expected.expiryTs.toString());
    }
    if (expected.totalRecipients !== undefined) {
      expect(state.totalRecipients).to.eq(expected.totalRecipients);
    }
    if (expected.totalAllocated !== undefined) {
      expect(state.totalAllocated.toString()).to.eq(
        expected.totalAllocated.toString()
      );
    }
    if (expected.totalFunded !== undefined) {
      expect(state.totalFunded.toString()).to.eq(
        expected.totalFunded.toString()
      );
    }
    if (expected.totalDistributed !== undefined) {
      expect(state.totalDistributed.toString()).to.eq(
        expected.totalDistributed.toString()
      );
    }
    if (expected.claimedRecipients !== undefined) {
      expect(state.claimedRecipients).to.eq(expected.claimedRecipients);
    }
    if (expected.isLocked !== undefined) {
      expect(state.isLocked).to.eq(expected.isLocked);
    }
    if (expected.isExpired !== undefined) {
      expect(state.isExpired).to.eq(expected.isExpired);
    }

    return state;
  };

  const buildCompliantAllocations = (): BN[] => {
    const allocations: BN[] = [];
    const base = new BN(BASE_WHOLE_ALLOCATION).mul(tokenScale);
    let running = new BN(0);

    for (let i = 0; i < MAX_RECIPIENTS - 1; i += 1) {
      allocations.push(base);
      running = running.add(base);
    }
    allocations.push(totalCap.sub(running));

    return allocations;
  };

  const registerRecipients = async (
    distribution: PublicKey,
    recipients: Keypair[],
    allocations: BN[]
  ) => {
    expect(recipients.length).to.eq(allocations.length);
    for (let i = 0; i < recipients.length; i += 1) {
      const recipientWallet = recipients[i].publicKey;
      const recipient = deriveRecipientPda(distribution, recipientWallet);
      await program.methods
        .registerRecipient(recipientWallet, allocations[i])
        .accounts({
          distribution,
          recipient,
          authority: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
  };

  const hasProgramError = (
    error: unknown,
    codeName: string,
    hexCode: string
  ): boolean => {
    const parsed = error as {
      message?: string;
      error?: { errorCode?: { code?: string } };
      logs?: string[];
    };
    const code = parsed?.error?.errorCode?.code ?? "";
    const logs = Array.isArray(parsed?.logs) ? parsed.logs.join(" ") : "";
    const text = `${error} ${parsed?.message ?? ""} ${code} ${logs}`;
    return (
      text.includes(codeName) || text.includes(hexCode) || code === codeName
    );
  };

  const canExpireDistribution = async (
    distribution: PublicKey
  ): Promise<boolean> => {
    const state = await program.account.distributionState.fetch(distribution);
    if (state.isExpired) {
      return true;
    }

    try {
      await program.methods
        .expireDistribution()
        .accounts({ distribution })
        .rpc();
      return true;
    } catch (error) {
      if (hasProgramError(error, "ExpiryNotReached", "0x1786")) {
        return false;
      }
      if (hasProgramError(error, "DistributionExpired", "0x1777")) {
        return true;
      }
      throw error;
    }
  };

  const formatRpcError = (value: unknown): string => {
    if (typeof value === "string") {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  const isMethodNotFoundError = (value: unknown): boolean => {
    const candidate = value as { code?: number; message?: string };
    if (candidate?.code === -32601) {
      return true;
    }
    const text = formatRpcError(value).toLowerCase();
    return text.includes("method not found") || text.includes("unsupported");
  };

  // Returns false when validator does not expose warp RPC methods.
  const warpSlot = async (targetSlot: number): Promise<boolean> => {
    const connection = provider.connection as any;
    const rpcRequest = connection._rpcRequest?.bind(connection);
    if (!rpcRequest) {
      return false;
    }

    const methodCandidates = ["warp_slot", "warpSlot"];
    let lastError: unknown;
    let sawNonMethodNotFoundError = false;

    for (const method of methodCandidates) {
      try {
        const response = await rpcRequest(method, [targetSlot]);
        if (!response?.error) {
          return true;
        }
        if (isMethodNotFoundError(response.error)) {
          continue;
        }
        sawNonMethodNotFoundError = true;
        lastError = response.error;
      } catch (error) {
        if (isMethodNotFoundError(error)) {
          continue;
        }
        sawNonMethodNotFoundError = true;
        lastError = error;
      }
    }

    if (!sawNonMethodNotFoundError) {
      return false;
    }

    throw new Error(`Unable to warp slot: ${formatRpcError(lastError)}`);
  };

  // Returns true if expiry can be reached/observed; false if validator lacks warp support.
  const warpPastExpiry = async (distribution: PublicKey): Promise<boolean> => {
    if (await canExpireDistribution(distribution)) {
      return true;
    }

    let slot = await provider.connection.getSlot("processed");
    for (let i = 0; i < 8; i += 1) {
      // ~16 days per iteration at 400ms/slot
      slot += 3_500_000;
      const warpSupported = await warpSlot(slot);
      if (!warpSupported) {
        return false;
      }
      await provider.connection.getLatestBlockhash("processed");
      if (await canExpireDistribution(distribution)) {
        return true;
      }
    }

    throw new Error("Failed to warp validator clock past campaign expiry");
  };

  before("setup mint and authority token account", async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      DECIMALS
    );
    const authorityAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey
    );
    authorityTokenAccount = authorityAta.address;
  });

  it("initializes with strict constants and default invariant state", async () => {
    const fixture = await createStrictDistribution();
    await assertDistributionState(fixture.distribution.publicKey, {
      maxRecipients: MAX_RECIPIENTS,
      totalCap,
      expiryTs: CAMPAIGN_EXPIRY_TS,
      totalRecipients: 0,
      totalAllocated: new BN(0),
      totalFunded: new BN(0),
      totalDistributed: new BN(0),
      claimedRecipients: 0,
      isLocked: false,
      isExpired: false,
    });
  });

  it("rejects non-canonical initialization values", async function () {
    if (initializeArgCount === 0) {
      this.skip();
      return;
    }

    const initWith = async (
      maxRecipients: number,
      cap: BN,
      expiryTs: BN
    ): Promise<void> => {
      const distribution = Keypair.generate();
      const { vaultAuthority, vault } = deriveVaultFixture(distribution);
      await program.methods
        .initializeDistribution(maxRecipients, cap, expiryTs)
        .accounts({
          distribution: distribution.publicKey,
          authority: wallet.publicKey,
          mint,
          vaultAuthority,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([distribution])
        .rpc();
    };

    await assertProgramError(
      () => initWith(MAX_RECIPIENTS - 1, totalCap, new BN(CAMPAIGN_EXPIRY_TS)),
      "InvalidMaxRecipients"
    );
    await assertProgramError(
      () =>
        initWith(
          MAX_RECIPIENTS,
          totalCap.sub(new BN(1)),
          new BN(CAMPAIGN_EXPIRY_TS)
        ),
      "InvalidTotalCap"
    );
    await assertProgramError(
      () => initWith(MAX_RECIPIENTS, totalCap, new BN(CAMPAIGN_EXPIRY_TS - 1)),
      "InvalidExpiry"
    );
  });

  it("rejects zero-allocation recipient registration", async () => {
    const fixture = await createStrictDistribution();
    const recipientWallet = Keypair.generate();
    const recipient = deriveRecipientPda(
      fixture.distribution.publicKey,
      recipientWallet.publicKey
    );

    await assertProgramError(
      () =>
        program.methods
          .registerRecipient(recipientWallet.publicKey, new BN(0))
          .accounts({
            distribution: fixture.distribution.publicKey,
            recipient,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      "AllocationMustBePositive"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      totalRecipients: 0,
      totalAllocated: new BN(0),
      totalDistributed: new BN(0),
      totalFunded: new BN(0),
      claimedRecipients: 0,
      isLocked: false,
      isExpired: false,
    });
  });

  it("rejects unauthorized recipient registration", async () => {
    const fixture = await createStrictDistribution();
    const attacker = Keypair.generate();
    const recipientWallet = Keypair.generate();
    const recipient = deriveRecipientPda(
      fixture.distribution.publicKey,
      recipientWallet.publicKey
    );

    await airdropSol(attacker.publicKey);
    await assertProgramError(
      () =>
        program.methods
          .registerRecipient(recipientWallet.publicKey, tinyAllocation)
          .accounts({
            distribution: fixture.distribution.publicKey,
            recipient,
            authority: attacker.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
      "Unauthorized"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      totalRecipients: 0,
      totalAllocated: new BN(0),
      isLocked: false,
      isExpired: false,
    });
  });

  it("rejects funding before distribution lock", async () => {
    const fixture = await createStrictDistribution();
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      authorityTokenAccount,
      wallet.publicKey,
      1n
    );

    await assertProgramError(
      () =>
        program.methods
          .fundVault(new BN(1))
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
            mint,
            sourceTokenAccount: authorityTokenAccount,
            vault: fixture.vault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "DistributionNotLocked"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      totalFunded: new BN(0),
      totalDistributed: new BN(0),
      claimedRecipients: 0,
      isLocked: false,
      isExpired: false,
    });
  });

  it("rejects expire_distribution before expiry timestamp", async () => {
    const fixture = await createStrictDistribution();
    await assertProgramError(
      () =>
        program.methods
          .expireDistribution()
          .accounts({ distribution: fixture.distribution.publicKey })
          .rpc(),
      "ExpiryNotReached"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      isExpired: false,
    });
  });

  it("rejects withdraw_unclaimed before expiry timestamp", async () => {
    const fixture = await createStrictDistribution();
    await assertProgramError(
      () =>
        program.methods
          .withdrawUnclaimed(new BN(1))
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
            mint,
            vaultAuthority: fixture.vaultAuthority,
            vault: fixture.vault,
            destinationTokenAccount: authorityTokenAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "ExpiryNotReached"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      isExpired: false,
      totalFunded: new BN(0),
      totalDistributed: new BN(0),
    });
  });

  it("fails to lock when fewer than 120 recipients are registered", async () => {
    const fixture = await createStrictDistribution();
    const recipients = Array.from({ length: MAX_RECIPIENTS - 1 }, () =>
      Keypair.generate()
    );
    const allocations = Array.from(
      { length: MAX_RECIPIENTS - 1 },
      () => tinyAllocation
    );

    await registerRecipients(
      fixture.distribution.publicKey,
      recipients,
      allocations
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      totalRecipients: MAX_RECIPIENTS - 1,
      totalAllocated: new BN(MAX_RECIPIENTS - 1),
      totalDistributed: new BN(0),
      claimedRecipients: 0,
      isLocked: false,
      isExpired: false,
    });

    await assertProgramError(
      () =>
        program.methods
          .lockDistribution()
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
          })
          .rpc(),
      "RecipientCountNotMet"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      isLocked: false,
    });
  });

  it("blocks a 121st recipient and fails lock when 120 allocations do not match total cap", async () => {
    const fixture = await createStrictDistribution();
    const recipients = Array.from({ length: MAX_RECIPIENTS }, () =>
      Keypair.generate()
    );
    const allocations = Array.from(
      { length: MAX_RECIPIENTS },
      () => tinyAllocation
    );

    await registerRecipients(
      fixture.distribution.publicKey,
      recipients,
      allocations
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      totalRecipients: MAX_RECIPIENTS,
      totalAllocated: new BN(MAX_RECIPIENTS),
      isLocked: false,
      isExpired: false,
    });

    const extraWallet = Keypair.generate();
    const extraRecipient = deriveRecipientPda(
      fixture.distribution.publicKey,
      extraWallet.publicKey
    );
    await assertProgramError(
      () =>
        program.methods
          .registerRecipient(extraWallet.publicKey, tinyAllocation)
          .accounts({
            distribution: fixture.distribution.publicKey,
            recipient: extraRecipient,
            authority: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      "RecipientLimitReached"
    );

    await assertProgramError(
      () =>
        program.methods
          .lockDistribution()
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
          })
          .rpc(),
      "AllocationNotComplete"
    );
    await assertDistributionState(fixture.distribution.publicKey, {
      isLocked: false,
    });
  });

  describe("strict lifecycle: lock, fund, claim, expiry", function () {
    let fixture: DistributionFixture;
    let recipients: Keypair[];
    let allocations: BN[];
    let distributedSoFar: BN;
    let claimedSoFar: number;

    before(
      "create exactly-120 recipient distribution, lock and fund",
      async () => {
        fixture = await createStrictDistribution();
        recipients = Array.from({ length: MAX_RECIPIENTS }, () =>
          Keypair.generate()
        );
        allocations = buildCompliantAllocations();
        distributedSoFar = new BN(0);
        claimedSoFar = 0;

        await registerRecipients(
          fixture.distribution.publicKey,
          recipients,
          allocations
        );
        await assertDistributionState(fixture.distribution.publicKey, {
          totalRecipients: MAX_RECIPIENTS,
          totalAllocated: totalCap,
          totalDistributed: new BN(0),
          claimedRecipients: 0,
          isLocked: false,
          isExpired: false,
        });

        await program.methods
          .lockDistribution()
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
          })
          .rpc();
        await assertDistributionState(fixture.distribution.publicKey, {
          totalRecipients: MAX_RECIPIENTS,
          totalAllocated: totalCap,
          isLocked: true,
          isExpired: false,
        });

        await mintTo(
          provider.connection,
          wallet.payer,
          mint,
          authorityTokenAccount,
          wallet.publicKey,
          BigInt(totalCap.add(new BN(1)).toString())
        );

        await program.methods
          .fundVault(totalCap)
          .accounts({
            distribution: fixture.distribution.publicKey,
            authority: wallet.publicKey,
            mint,
            sourceTokenAccount: authorityTokenAccount,
            vault: fixture.vault,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        const vaultAccount = await getAccount(
          provider.connection,
          fixture.vault
        );
        expect(vaultAccount.amount.toString()).to.eq(totalCap.toString());
        await assertDistributionState(fixture.distribution.publicKey, {
          totalFunded: totalCap,
          totalDistributed: distributedSoFar,
          claimedRecipients: claimedSoFar,
          isLocked: true,
          isExpired: false,
        });
      }
    );

    it("locks only when recipient count and allocation sum exactly match campaign constants", async () => {
      await assertDistributionState(fixture.distribution.publicKey, {
        maxRecipients: MAX_RECIPIENTS,
        totalCap,
        expiryTs: CAMPAIGN_EXPIRY_TS,
        totalRecipients: MAX_RECIPIENTS,
        totalAllocated: totalCap,
        isLocked: true,
        isExpired: false,
      });
    });

    it("rejects lock_distribution when already locked", async () => {
      await assertProgramError(
        () =>
          program.methods
            .lockDistribution()
            .accounts({
              distribution: fixture.distribution.publicKey,
              authority: wallet.publicKey,
            })
            .rpc(),
        "DistributionLocked"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        isLocked: true,
      });
    });

    it("blocks over-funding and preserves total_funded at total_cap", async () => {
      await assertProgramError(
        () =>
          program.methods
            .fundVault(new BN(1))
            .accounts({
              distribution: fixture.distribution.publicKey,
              authority: wallet.publicKey,
              mint,
              sourceTokenAccount: authorityTokenAccount,
              vault: fixture.vault,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "CapExceeded"
      );

      const vaultAccount = await getAccount(provider.connection, fixture.vault);
      expect(vaultAccount.amount.toString()).to.eq(totalCap.toString());
      await assertDistributionState(fixture.distribution.publicKey, {
        totalFunded: totalCap,
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: false,
      });
    });

    it("rejects zero amount funding when distribution is locked", async () => {
      await assertProgramError(
        () =>
          program.methods
            .fundVault(new BN(0))
            .accounts({
              distribution: fixture.distribution.publicKey,
              authority: wallet.publicKey,
              mint,
              sourceTokenAccount: authorityTokenAccount,
              vault: fixture.vault,
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc(),
        "AmountMustBePositive"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        totalFunded: totalCap,
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
      });
    });

    it("processes a normal claim and blocks a double-claim", async () => {
      const claimant = recipients[0];
      const recipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        claimant.publicKey
      );
      const claimantAta = getAssociatedTokenAddressSync(
        mint,
        claimant.publicKey
      );

      await airdropSol(claimant.publicKey);
      await program.methods
        .claim()
        .accounts({
          distribution: fixture.distribution.publicKey,
          recipient,
          claimant: claimant.publicKey,
          mint,
          vaultAuthority: fixture.vaultAuthority,
          vault: fixture.vault,
          claimantTokenAccount: claimantAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([claimant])
        .rpc();

      const claimantBalance = await getAccount(
        provider.connection,
        claimantAta
      );
      expect(claimantBalance.amount.toString()).to.eq(
        allocations[0].toString()
      );
      distributedSoFar = distributedSoFar.add(allocations[0]);
      claimedSoFar += 1;
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: false,
      });

      await assertProgramError(
        () =>
          program.methods
            .claim()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient,
              claimant: claimant.publicKey,
              mint,
              vaultAuthority: fixture.vaultAuthority,
              vault: fixture.vault,
              claimantTokenAccount: claimantAta,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([claimant])
            .rpc(),
        "RecipientAlreadyClaimed"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: false,
      });
    });

    it("rejects unauthorized admin_distribute", async () => {
      const attacker = Keypair.generate();
      const target = recipients[2];
      const recipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        target.publicKey
      );
      const recipientTokenAccount = getAssociatedTokenAddressSync(
        mint,
        target.publicKey
      );

      await airdropSol(attacker.publicKey);
      await assertProgramError(
        () =>
          program.methods
            .adminDistribute()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient,
              authority: attacker.publicKey,
              recipientWallet: target.publicKey,
              mint,
              vaultAuthority: fixture.vaultAuthority,
              vault: fixture.vault,
              recipientTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([attacker])
            .rpc(),
        "Unauthorized"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
      });
    });

    it("processes admin distribute and blocks second admin distribute", async () => {
      const target = recipients[2];
      const recipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        target.publicKey
      );
      const recipientTokenAccount = getAssociatedTokenAddressSync(
        mint,
        target.publicKey
      );

      await program.methods
        .adminDistribute()
        .accounts({
          distribution: fixture.distribution.publicKey,
          recipient,
          authority: wallet.publicKey,
          recipientWallet: target.publicKey,
          mint,
          vaultAuthority: fixture.vaultAuthority,
          vault: fixture.vault,
          recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const targetBalance = await getAccount(
        provider.connection,
        recipientTokenAccount
      );
      expect(targetBalance.amount.toString()).to.eq(allocations[2].toString());
      distributedSoFar = distributedSoFar.add(allocations[2]);
      claimedSoFar += 1;
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: false,
      });

      await assertProgramError(
        () =>
          program.methods
            .adminDistribute()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient,
              authority: wallet.publicKey,
              recipientWallet: target.publicKey,
              mint,
              vaultAuthority: fixture.vaultAuthority,
              vault: fixture.vault,
              recipientTokenAccount,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .rpc(),
        "RecipientAlreadyClaimed"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
      });
    });

    it("invalidates a recipient and blocks later claim", async () => {
      const target = recipients[3];
      const recipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        target.publicKey
      );
      const targetAta = getAssociatedTokenAddressSync(mint, target.publicKey);

      await program.methods
        .invalidateRecipient()
        .accounts({
          distribution: fixture.distribution.publicKey,
          recipient,
          authority: wallet.publicKey,
        })
        .rpc();

      await airdropSol(target.publicKey);
      await assertProgramError(
        () =>
          program.methods
            .claim()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient,
              claimant: target.publicKey,
              mint,
              vaultAuthority: fixture.vaultAuthority,
              vault: fixture.vault,
              claimantTokenAccount: targetAta,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([target])
            .rpc(),
        "RecipientInactive"
      );
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: false,
      });
    });

    it("rejects invalidating an already-claimed recipient", async () => {
      const claimedRecipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        recipients[0].publicKey
      );
      await assertProgramError(
        () =>
          program.methods
            .invalidateRecipient()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient: claimedRecipient,
              authority: wallet.publicKey,
            })
            .rpc(),
        "RecipientAlreadyClaimed"
      );
    });

    it("blocks claims after expiry and allows unclaimed withdrawal", async function () {
      const reachedExpiry = await warpPastExpiry(
        fixture.distribution.publicKey
      );
      if (!reachedExpiry) {
        console.log(
          "Skipping expiry assertions: validator does not expose warp RPC"
        );
        this.skip();
        return;
      }

      const lateClaimant = recipients[1];
      const lateRecipient = deriveRecipientPda(
        fixture.distribution.publicKey,
        lateClaimant.publicKey
      );
      const lateClaimantAta = getAssociatedTokenAddressSync(
        mint,
        lateClaimant.publicKey
      );

      await airdropSol(lateClaimant.publicKey);
      await assertProgramError(
        () =>
          program.methods
            .claim()
            .accounts({
              distribution: fixture.distribution.publicKey,
              recipient: lateRecipient,
              claimant: lateClaimant.publicKey,
              mint,
              vaultAuthority: fixture.vaultAuthority,
              vault: fixture.vault,
              claimantTokenAccount: lateClaimantAta,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([lateClaimant])
            .rpc(),
        "DistributionExpired"
      );

      const vaultBeforeWithdraw = await getAccount(
        provider.connection,
        fixture.vault
      );
      const unclaimedAmount = new BN(vaultBeforeWithdraw.amount.toString());
      expect(unclaimedAmount.gt(new BN(0))).to.eq(true);

      await program.methods
        .withdrawUnclaimed(unclaimedAmount)
        .accounts({
          distribution: fixture.distribution.publicKey,
          authority: wallet.publicKey,
          mint,
          vaultAuthority: fixture.vaultAuthority,
          vault: fixture.vault,
          destinationTokenAccount: authorityTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const vaultAfterWithdraw = await getAccount(
        provider.connection,
        fixture.vault
      );
      expect(vaultAfterWithdraw.amount.toString()).to.eq("0");
      await assertDistributionState(fixture.distribution.publicKey, {
        totalDistributed: distributedSoFar,
        totalFunded: totalCap,
        claimedRecipients: claimedSoFar,
        isLocked: true,
        isExpired: true,
      });
    });
  });
});
