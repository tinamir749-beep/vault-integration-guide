# OVault SDK Integration Guide

## Documentation

For full details on architecture, deposit/redeem flows, transaction tracking, EIP-2612 permit support, and the SDK parameter reference, see the [Vault Integration Guide](https://docs.zircuit.com/zircuit-finance/zircuit-finance-vaults/vault-integration-guide).

---

## Runnable Scripts

This folder includes a single `run.ts` script that covers all three flows — **quote**, **execute**, and **track** — using CLI flags. No `.env` file required.

### Setup

```bash
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
| `--rpc-ethereum` | | | Custom RPC URL for Ethereum |
| `--rpc-base` | | | Custom RPC URL for Base |

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

# 6. Use custom RPC URLs to avoid public rate limits
npx tsx scripts/run.ts quote \
  --wallet 0xYourWallet \
  --rpc-ethereum https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY \
  --rpc-base https://base-mainnet.g.alchemy.com/v2/YOUR_KEY

# Or use the npm script shortcuts:
npm run quote -- --wallet 0xYourWallet
npm run execute -- --wallet 0xYourWallet --private-key 0xYourKey
npm run track -- --wallet 0xYourWallet --tx-hash 0xHash
```
