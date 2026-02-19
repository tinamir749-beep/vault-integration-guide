#!/usr/bin/env npx tsx
/**
 * Unified OVault SDK runner — quote, execute, or track in one command.
 *
 * Usage:
 *   npx tsx scripts/run.ts <command> [options]
 *
 * Commands:
 *   quote     Preview fees and output amounts (read-only)
 *   execute   Approve + submit transaction on-chain
 *   track     Poll a submitted tx until completion
 *
 * Examples:
 *   npx tsx scripts/run.ts quote   --wallet 0xYou
 *   npx tsx scripts/run.ts execute --wallet 0xYou --private-key 0xKey
 *   npx tsx scripts/run.ts track   --wallet 0xYou --tx-hash 0xABC
 *
 * Run with --help for full option list.
 */

import { parseArgs } from "node:util";
import {
  createWalletClient,
  erc20Abi,
  http,
  parseSignature,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CHAINS,
  OVaultSyncMessageBuilder,
  OVaultSyncOperations,
  trackOVaultSyncTransaction,
} from "@zircuit/ovault-evm";
import type {
  OVaultCoreInputs,
  SupportedChainName,
  SupportedToken,
} from "@zircuit/ovault-evm";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const HELP = `
Usage: npx tsx scripts/run.ts <command> [options]

Commands:
  quote     Preview fees and output amounts (read-only)
  execute   Approve + submit transaction on-chain
  track     Poll a submitted tx until completion

Required:
  --wallet, -w         Wallet address (0x...)

Execute only:
  --private-key        Private key (0x...)

Track only:
  --tx-hash            Transaction hash to track (0x...)

Options:
  --source, -s         Source chain           [default: ethereum]
  --destination, -d    Destination chain      [default: ethereum]
  --token, -t          Token                  [default: usdc]
  --operation, -o      deposit | redeem       [default: deposit]
  --amount, -a         Human-readable amount  [default: 1.0]
  --slippage           Slippage tolerance     [default: 0.01]
  --buffer             Extra % on LZ fee      [default: 0.3]
  --permit             Use EIP-2612 permit    [default: false]
  --dst-address        Recipient if != wallet
  --referral-code      Referral code
  --rpc-ethereum       Custom RPC URL for Ethereum
  --rpc-base           Custom RPC URL for Base
  --help, -h           Show this help message
`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source:          { type: "string",  short: "s", default: "ethereum" },
    destination:     { type: "string",  short: "d", default: "ethereum" },
    token:           { type: "string",  short: "t", default: "usdc" },
    operation:       { type: "string",  short: "o", default: "deposit" },
    amount:          { type: "string",  short: "a", default: "1.0" },
    wallet:          { type: "string",  short: "w" },
    "private-key":   { type: "string" },
    "tx-hash":       { type: "string" },
    "dst-address":   { type: "string" },
    slippage:        { type: "string",  default: "0.01" },
    buffer:          { type: "string",  default: "0.3" },
    permit:          { type: "boolean", default: false },
    "referral-code": { type: "string" },
    "rpc-ethereum":  { type: "string" },
    "rpc-base":      { type: "string" },
    help:            { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const command = positionals[0] as "quote" | "execute" | "track";

if (!["quote", "execute", "track"].includes(command)) {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Hex = `0x${string}`;

function requireFlag(name: string): string {
  const val = values[name as keyof typeof values] as string | undefined;
  if (!val) {
    console.error(`Missing required flag: --${name}`);
    process.exit(1);
  }
  return val;
}

function buildRpcUrls(): Partial<Record<SupportedChainName, string>> | undefined {
  const urls: Partial<Record<SupportedChainName, string>> = {};
  if (values["rpc-ethereum"]) urls.ethereum = values["rpc-ethereum"];
  if (values["rpc-base"]) urls.base = values["rpc-base"];
  return Object.keys(urls).length > 0 ? urls : undefined;
}

function buildInputs(): OVaultCoreInputs {
  const wallet = requireFlag("wallet") as Hex;

  return {
    sourceChain: values.source as SupportedChainName,
    destinationChain: values.destination as SupportedChainName,
    token: values.token as SupportedToken,
    operation:
      values.operation === "redeem"
        ? OVaultSyncOperations.REDEEM
        : OVaultSyncOperations.DEPOSIT,
    amount: values.amount!,
    walletAddress: wallet,
    dstAddress: values["dst-address"] as Hex | undefined,
    slippage: Number(values.slippage),
    buffer: values.buffer ? Number(values.buffer) : undefined,
    supportsEip2612: values.permit,
    referralCode: values["referral-code"],
    rpcUrls: buildRpcUrls(),
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function runQuote() {
  const input = buildInputs();
  console.log(`Quoting ${input.operation} of ${input.amount} ${values.token}...\n`);

  const result = await OVaultSyncMessageBuilder.generateOVaultInputs(input);

  console.log("Contract:         ", result.contractAddress);
  console.log("Function:         ", result.contractFunctionName);
  console.log("Native fee (wei): ", result.messageFee.nativeFee.toString());
  console.log("Dst amount:       ", result.dstAmount.amount.toString());
  console.log("Min dst amount:   ", result.dstAmount.minAmount.toString());

  if (result.approval) {
    console.log("\nApproval required:");
    console.log("  Token:   ", result.approval.tokenAddress);
    console.log("  Spender: ", result.approval.spender);
    console.log("  Amount:  ", result.approval.amount.toString());
    console.log("  Permit:  ", result.approval.usePermit ? "yes" : "no");
  } else {
    console.log("\nNo approval needed.");
  }
}

async function runExecute() {
  const input = buildInputs();
  const privateKey = requireFlag("private-key") as Hex;
  const account = privateKeyToAccount(privateKey);

  if (account.address.toLowerCase() !== input.walletAddress.toLowerCase()) {
    throw new Error(
      `Private key address (${account.address}) does not match --wallet (${input.walletAddress})`,
    );
  }

  console.log(`Generating ${input.operation} inputs...\n`);
  const result = await OVaultSyncMessageBuilder.generateOVaultInputs(input);
  const srcChain = CHAINS[input.sourceChain].viemChain;
  const sourceRpcUrl = input.rpcUrls?.[input.sourceChain];

  const client = createWalletClient({
    account,
    chain: srcChain,
    transport: http(sourceRpcUrl),
  }).extend(publicActions);

  // --- Approval ---------------------------------------------------------------
  if (result.approval && !result.approval.usePermit) {
    if (result.approval.needsResetApproval) {
      console.log("Resetting approval to 0...");
      const resetHash = await client.writeContract({
        address: result.approval.tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [result.approval.spender, 0n],
      });
      await client.waitForTransactionReceipt({ hash: resetHash });
      console.log("Reset confirmed:", resetHash);
    }

    console.log("Approving token spend...");
    const approveHash = await client.writeContract({
      address: result.approval.tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [result.approval.spender, result.approval.amount],
    });
    await client.waitForTransactionReceipt({ hash: approveHash });
    console.log("Approval confirmed:", approveHash);
  }

  // --- Build tx (with permit if applicable) -----------------------------------
  let txRequest: { to: Hex; data: Hex; value: bigint };

  if (result.approval?.usePermit) {
    const approval = result.approval;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

    const signature = await client.signTypedData({
      account,
      domain: {
        name: approval.tokenName,
        version: approval.tokenVersion ?? "1",
        chainId: srcChain.id,
        verifyingContract: approval.tokenAddress,
      },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: {
        owner: input.walletAddress,
        spender: approval.spender,
        value: approval.amount,
        nonce: approval.nonce!,
        deadline,
      },
    });

    const { v, r, s } = parseSignature(signature);
    txRequest = OVaultSyncMessageBuilder.encodeTransactionRequest(result, [
      deadline,
      v!,
      r,
      s,
    ]);
  } else {
    txRequest = OVaultSyncMessageBuilder.encodeTransactionRequest(result);
  }

  // --- Submit -----------------------------------------------------------------
  console.log("Submitting transaction...");
  const txHash = await client.sendTransaction({ ...txRequest, chain: srcChain });

  console.log("\nTransaction submitted!");
  console.log("Hash:", txHash);
}

async function runTrack() {
  const txHash = requireFlag("tx-hash") as Hex;
  const sourceName = values.source as SupportedChainName;
  const dstName = values.destination as SupportedChainName;
  const sourceChain = CHAINS[sourceName].viemChain;
  const hubChain = CHAINS.base.viemChain;
  const dstChain = CHAINS[dstName].viemChain;
  const rpcUrls = buildRpcUrls();
  const timeoutMs = 900_000;
  const pollMs = 10_000;

  console.log(`Tracking tx: ${txHash}`);
  console.log(`Source: ${sourceName} | Destination: ${dstName}\n`);

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await trackOVaultSyncTransaction(txHash, {
      sourceChain,
      hubChain,
      dstChain,
      rpcUrls: rpcUrls
        ? {
            sourceChain: rpcUrls[sourceName],
            hubChain: rpcUrls.base,
            dstChain: rpcUrls[dstName],
          }
        : undefined,
    });

    console.log(`[${new Date().toISOString()}] step: ${status.step}`);

    if (status.step === "completed") {
      console.log("\nTransaction completed!");
      console.log(status);
      return;
    }

    if (status.failureReason) {
      console.error("\nTransaction failed:");
      console.error(status);
      process.exitCode = 1;
      return;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  console.error(`\nTimed out after ${timeoutMs}ms`);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const commands = { quote: runQuote, execute: runExecute, track: runTrack };
commands[command]().catch((err) => {
  console.error(`${command} failed:`, err);
  process.exitCode = 1;
});
