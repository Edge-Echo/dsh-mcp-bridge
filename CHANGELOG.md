# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-08-15

### Added

- Curated MCP server bundle for DeepSeek Harness (dsh):
  - Demo server (MCP official `everything`) enabled by default — zero config.
  - Commented presets: memory, GitHub, Playwright, SQLite, remote HTTP.
- `servers/` catalog: machine-readable definitions for every curated server
  with verification status.
- `scripts/verify-servers.mjs`: batch connectivity checker over the catalog
  (uses the MCP SDK that ships with `@deepseek-ai/dsh-mcp-client`).
- `scripts/probe-server.mjs`: single-server handshake probe for troubleshooting.
- Bilingual docs: English `README.md` + Chinese `README.zh.md`.
- GitHub Actions: `verify.yml` (CI connectivity checks) and `publish.yml`
  (tag-triggered npm release via OIDC).
- End-to-end verified on Windows: model called `mcp__everything__echo` and
  received `Echo: hello`.
