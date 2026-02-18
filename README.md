# OVault SDK Integration Guide

## Install

```bash
npm install
```

---

## Architecture

Every OVault transaction involves three chain roles:

| Role | Description |
|------|-------------|
| **Source** | Where the user signs and submits the transaction |
| **Hub** | Where the vault and accounting logic live (always Base) |
| **Destination** | Where the user receives tokens or shares |

These roles produce four flow patterns:

| Pattern | Meaning |
|---------|---------|
| **BBB** | Source, hub, and destination are the same chain |
| **BBA** | Source = hub, destination is a different chain |
| **ABB** | Source is different, hub = destination |
| **ABA** | All different (or source = destination, hub differs) |

The SDK handles all four patterns automatically.

---

## Quick Start: Deposit

This example deposits usdc from Ethereum into a vault on Base, with shares delivered back to Ethereum (an **ABA** flow).

### 1. Configure inputs

```typescript
import { OVaultSyncOperations } from "@zircuit/ovault-evm";
import type { OVaultCoreInputs } from "@zircuit/ovault-evm";

const input: OVaultCoreInputs = {
  sourceChain: "ethereum",
  destinationChain: "ethereum",
  token: "usdc",

  walletAddress: "0xYourWallet",

  operation: OVaultSyncOperations.DEPOSIT,
  amount: "100",
  slippage: 0.01,
  buffer: 0.3,
};
```

### 2. Generate transaction data

```typescript
import { OVaultSyncMessageBuilder } from "@zircuit/ovault-evm";

const result = await OVaultSyncMessageBuilder.generateOVaultInputs(input);
```

`result` contains everything needed to submit the transaction:

| Field | Description |
|-------|-------------|
| `contractAddress` | Address to call |
| `abi` | Contract ABI |
| `contractFunctionName` | Function to call (`send`, `depositAndSend`, etc.) |
| `txArgs` | Function arguments |
| `messageFee` | LayerZero fee to attach as `msg.value` |
| `approval` | Token approval info (if needed) |
| `dstAmount` | Previewed output and slippage floor |

### 3. Handle approval

```typescript
import { createWalletClient, erc20Abi, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "@zircuit/ovault-evm";

const account = privateKeyToAccount("0xYourPrivateKey");
const client = createWalletClient({
  account,
  chain: CHAINS.ethereum.viemChain,
  transport: http(),
}).extend(publicActions);

if (result.approval && !result.approval.usePermit) {
  await client.writeContract({
    address: result.approval.tokenAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [result.approval.spender, result.approval.amount],
  });
}
```

### 4. Execute

Use `encodeTransactionRequest` to build a ready-to-send transaction from the SDK output:

```typescript
const txRequest = OVaultSyncMessageBuilder.encodeTransactionRequest(result);

const txHash = await client.sendTransaction(txRequest);
```

---

## Quick Start: Redeem

Redeeming swaps vault shares back into the underlying asset. Only `operation` changes:

```typescript
const redeemInput: OVaultCoreInputs = {
  ...input,
  operation: OVaultSyncOperations.REDEEM,
};

const redeemResult = await OVaultSyncMessageBuilder.generateOVaultInputs(redeemInput);
```

The approval, encoding, and execution steps are identical to the deposit flow.

---

## Transaction Tracking

After submitting, poll `trackOVaultSyncTransaction` until the status reaches `completed`.

```typescript
import { trackOVaultSyncTransaction, CHAINS } from "@zircuit/ovault-evm";

const status = await trackOVaultSyncTransaction(
  txHash,
  {
    sourceChain: CHAINS.ethereum.viemChain,
    hubChain: CHAINS.base.viemChain,
    dstChain: CHAINS.ethereum.viemChain,
  },
);

console.log(status.step);
// Possible values:
//   "sourceChainTransaction"
//   "sourceToHubLzTransaction"
//   "hubChainTransaction"
//   "hubToDstLzTransaction"
//   "dstChainTransaction"
//   "completed"
```

For multi-withdrawal transactions, pass the withdrawal info:

```typescript
const status = await trackOVaultSyncTransaction(
  txHash,
  { sourceChain: CHAINS.ethereum.viemChain, hubChain: CHAINS.base.viemChain, dstChain: CHAINS.ethereum.viemChain },
  { index: "0", initiator: "0xYourWallet" },
);
```

---

## EIP-2612 Permit (Optional)

If the source token supports EIP-2612, set `supportsEip2612: true` in the input. When `result.approval.usePermit` is `true`, sign a permit instead of calling `approve`:

```typescript
import { parseSignature } from "viem";

const approval = result.approval!;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);

const signature = await client.signTypedData({
  account,
  domain: {
    name: approval.tokenName,
    version: approval.tokenVersion ?? "1",
    chainId: CHAINS.ethereum.viemChain.id,
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
    owner: "0xYourWallet",
    spender: approval.spender,
    value: approval.amount,
    nonce: approval.nonce!,
    deadline,
  },
});

const { v, r, s } = parseSignature(signature);
const txRequest = OVaultSyncMessageBuilder.encodeTransactionRequest(
  result,
  [deadline, v!, r, s],
);

await client.sendTransaction(txRequest);
```

---

## Key Parameters Reference

### `OVaultCoreInputs`

| Parameter | Type | Description |
|-----------|------|-------------|
| `sourceChain` | `"ethereum" \| "base"` | Source chain name |
| `destinationChain` | `"ethereum" \| "base"` | Destination chain name |
| `token` | `"usdc" \| "usdt"` | Token to deposit or redeem |
| `walletAddress` | `0x${string}` | User's wallet address |
| `dstAddress` | `0x${string}` | *(optional)* Recipient address if different from wallet |
| `operation` | `"deposit" \| "redeem"` | Operation type |
| `amount` | `string` | Human-readable amount (e.g. `"100"`) |
| `slippage` | `number` | Slippage tolerance (e.g. `0.01` = 1%, minimum `0.001`) |
| `buffer` | `number` | *(optional)* Extra % added to LZ fee quote (e.g. `0.3` = 30%) |
| `supportsEip2612` | `boolean` | *(optional)* Enable permit-based approval |
| `requiresZeroApprovalReset` | `boolean` | *(optional)* Reset allowance to zero before approving (e.g. USDT) |
| `hubLzComposeGasLimit` | `bigint` | *(optional)* Gas limit for hub compose. Defaults to `300000` |
| `referralCode` | `string` | *(optional)* Referral code |

---

## Runnable Scripts

This folder includes a single `run.ts` script that covers all three flows — **quote**, **execute**, and **track** — using CLI flags. No `.env` file required.

### Setup

```bash
cd integration
npm install
```

### Usage

```bash
npx tsx scripts/run.ts <command> [options]
```

### Commands

| Command | What it does | Requires `--private-key`? |
|---------|--------------|---------------------------|
| `quote` | Preview deposit/redeem output, fees, and approval requirements | No |
| `execute` | Approve + submit the vault transaction on-chain | Yes |
| `track` | Poll a submitted tx until completion or timeout | No |

### Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--source` | `-s` | `ethereum` | Source chain |
| `--destination` | `-d` | `ethereum` | Destination chain |
| `--token` | `-t` | `usdc` | Token |
| `--operation` | `-o` | `deposit` | `deposit` or `redeem` |
| `--amount` | `-a` | `1.0` | Human-readable amount |
| `--wallet` | `-w` | *(required)* | Wallet address |
| `--private-key` | | | Private key (execute only) |
| `--tx-hash` | | | Transaction hash (track only) |
| `--slippage` | | `0.01` | Slippage tolerance |
| `--buffer` | | `0.3` | Extra % on LZ fee estimate |
| `--permit` | | `false` | Use EIP-2612 permit |
| `--dst-address` | | | Recipient if different from wallet |
| `--referral-code` | | | Referral code |

### Examples

```bash
# 1. Quote a deposit (read-only, no private key)
npx tsx scripts/run.ts quote \
  --wallet 0xYourWallet

# 2. Quote a redeem from Base to Ethereum
npx tsx scripts/run.ts quote \
  --wallet 0xYourWallet \
  --source base \
  --destination ethereum \
  --operation redeem

# 3. Execute a deposit on-chain
npx tsx scripts/run.ts execute \
  --wallet 0xYourWallet \
  --private-key 0xYourPrivateKey \
  --amount 10

# 4. Execute with permit
npx tsx scripts/run.ts execute \
  --wallet 0xYourWallet \
  --private-key 0xYourPrivateKey \
  --permit

# 5. Track a submitted transaction
npx tsx scripts/run.ts track \
  --wallet 0xYourWallet \
  --tx-hash 0xYourTxHash

# Or use the npm script shortcuts:
npm run quote -- --wallet 0xYourWallet
npm run execute -- --wallet 0xYourWallet --private-key 0xYourKey
npm run track -- --wallet 0xYourWallet --tx-hash 0xHash
```
