# 🔒 Agentic Wallet Guard

[![CI](https://github.com/FrancisZamora/agentic-wallet-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/FrancisZamora/agentic-wallet-guard/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**A security framework for AI agents with crypto wallets.**

AI agents are getting wallets. But who guards the guard? This framework adds human-in-the-loop verification, allowlists, rate limits, and kill switches to prevent unauthorized transactions from agentic wallets.

Built for [Coinbase Agentic Wallet](https://docs.cdp.coinbase.com/agentic-wallet/quickstart) (`awal`), but designed to be wallet-agnostic.

## Why?

AI agents can be tricked via:
- **Prompt injection** — malicious content in web pages, emails, or messages
- **Social engineering** — impersonating the owner
- **Address manipulation** — swapping legit addresses with attacker addresses
- **Unauthorized senders** — messages from unverified sources

This framework ensures every outgoing transaction goes through multiple security checkpoints before execution.

## Security Layers

| Layer | Protection | How |
|-------|-----------|-----|
| 🔐 Sender Verification | Only authorized users can request transactions | Sender allowlist by platform/ID |
| 🔢 Confirmation Code | Human must approve each transaction | Random 6-digit OTP, 5-min expiry |
| 📋 Address Allowlist | Only send to pre-approved addresses | Trusted address registry with labels |
| 💰 Transaction Limits | Cap per-tx and daily spending | Configurable thresholds |
| ⏱️ Cooldown & Logging | Prevent rapid-fire attacks | Min delay between tx, full audit log |
| 🛑 Kill Switch | Instant freeze on suspicion | Passphrase to halt all activity |
| 🔨 Brute Force Guard | Block code-guessing attacks | Auto-cancel after 3 wrong codes |
| 🧬 File Integrity | Detect config/state tampering | HMAC-SHA256 signatures on every read |
| 👤 Sender Match | Prevent confirmation hijacking | Verify sender on confirm matches requester |

## What's New in v0.2.0

### Security Hardening

| Fix | Description |
|-----|-------------|
| Brute Force Protection | Max 3 confirmation attempts per transaction. Auto-cancels after 3 wrong codes. |
| File Integrity (HMAC) | HMAC-SHA256 signatures for config, allowlist, and state files. Detects tampering before every read. |
| Sender Verification on Confirm | `confirmSend()` verifies the confirming sender matches the original requester. |
| Log Redaction | Confirmation codes never appear in transaction logs. |
| Pinned Dependencies | `awal` dependency pinned to exact version (no `^` or `~`). |

### Setup Integrity Checks

Set the `AWG_INTEGRITY_SECRET` environment variable to enable file integrity verification:

```bash
export AWG_INTEGRITY_SECRET="your-secret-key"
```

When set, all config/state/allowlist reads are verified against HMAC-SHA256 signatures stored in `.awg/.signatures`. If a file has been tampered with outside the guard, operations will be rejected.

## Quick Start

```bash
# Install
npm install agentic-wallet-guard

# Initialize config
npx awg init

# Add a trusted address
npx awg allowlist add 0x1234... --label "My Coinbase"

# Send with guard (wraps awal send)
npx awg send 5 0x1234... --confirm
# → Generates confirmation code
# → Waits for human approval
# → Executes or rejects
```

## Configuration

```json
{
  "limits": {
    "perTransaction": 50,
    "dailyMax": 200,
    "highValueThreshold": 100
  },
  "cooldown": {
    "betweenTransactions": 30,
    "afterRejection": 300
  },
  "confirmation": {
    "codeExpiry": 300,
    "requiredForAllSends": true
  },
  "freezeOnAnomalies": {
    "rapidRequests": 3,
    "windowSeconds": 60
  }
}
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  AI Agent   │────▶│ Wallet Guard │────▶│ awal / CDP  │
│  (request)  │     │  (verify)    │     │  (execute)  │
└─────────────┘     └──────────────┘     └─────────────┘
                          │
                    ┌─────┴─────┐
                    │  Human    │
                    │  (approve)│
                    └───────────┘
```

## For AI Agent Developers

This framework is designed to sit between your agent and its wallet. It works with any agent framework:
- OpenClaw
- LangChain
- AutoGPT
- CrewAI
- Custom agents

## Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
