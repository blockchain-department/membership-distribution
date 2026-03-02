import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export const PROGRAM_ID = new PublicKey(
  "54MDjjmV8xPhsgW2R2rKXVmTogyph6TJ5VKUcKgB7TYm"
);
export const RECIPIENT_SEED = Buffer.from("recipient");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority");

export type WalletWithPayer = anchor.Wallet & { payer: Keypair };

export function getProvider(): anchor.AnchorProvider {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  return provider;
}

export function getProgram(
  provider: anchor.AnchorProvider
): anchor.Program<anchor.Idl> {
  const workspace = anchor.workspace as Record<
    string,
    anchor.Program<anchor.Idl>
  >;
  const fromWorkspace =
    workspace.MembershipDistribution ?? workspace.membershipDistribution;
  if (fromWorkspace) {
    return fromWorkspace;
  }

  const idlPath = path.join(
    process.cwd(),
    "target",
    "idl",
    "membership_distribution.json"
  );
  if (!existsSync(idlPath)) {
    throw new Error(`IDL not found: ${idlPath}. Run \`anchor build\` first.`);
  }

  const idl = JSON.parse(readFileSync(idlPath, "utf-8")) as anchor.Idl & {
    address?: string;
  };
  if (!idl.address) {
    idl.address = PROGRAM_ID.toBase58();
  }
  return new anchor.Program(idl as anchor.Idl, provider);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

export function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for ${name}: ${raw}`);
  }
  return parsed;
}

export function parseIsoToUnix(isoDate: string): number {
  const ms = Date.parse(isoDate);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO date: ${isoDate}`);
  }
  return Math.floor(ms / 1000);
}

export function wholeTokensToRaw(wholeTokens: string, decimals: number): BN {
  const whole = BigInt(wholeTokens);
  const scale = 10n ** BigInt(decimals);
  return new BN((whole * scale).toString());
}

export function deriveVaultAuthority(
  distribution: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, distribution.toBuffer()],
    programId
  )[0];
}

export function deriveRecipientPda(
  distribution: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [RECIPIENT_SEED, distribution.toBuffer(), wallet.toBuffer()],
    programId
  )[0];
}

export function loadKeypair(filePath: string): Keypair {
  const fullPath = path.resolve(filePath);
  const raw = JSON.parse(readFileSync(fullPath, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function saveKeypair(filePath: string, keypair: Keypair): void {
  const fullPath = path.resolve(filePath);
  const dir = path.dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(fullPath, JSON.stringify(Array.from(keypair.secretKey)));
}
