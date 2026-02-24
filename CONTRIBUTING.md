# Contributing to Agentic Wallet Guard

Thanks for your interest in making AI agent wallets safer! 🔒

## How to Contribute

1. **Fork** the repo
2. **Create a branch** (`git checkout -b feature/my-feature`)
3. **Make changes** and test them
4. **Submit a PR** with a clear description

## Ideas for Contributions

- **Multi-sig support** — require multiple agents/humans to approve
- **Wallet provider adapters** — support for MetaMask, Phantom, etc.
- **Notification channels** — Telegram, Discord, email alerts for transactions
- **Hardware wallet integration** — Ledger/Trezor as approval device
- **Time-based rules** — only allow sends during business hours
- **Geo-fencing** — block sends from unexpected locations
- **Machine learning anomaly detection** — learn normal spending patterns

## Code Style

- ES Modules (`.mjs`)
- No external dependencies in core (Node.js built-ins only)
- Keep it simple — security code should be auditable

## Security Issues

If you find a security vulnerability, please **do not** open a public issue. Email security concerns privately.

## License

By contributing, you agree your code is licensed under MIT.
