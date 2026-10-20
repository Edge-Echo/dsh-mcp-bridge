# Changelog

## 0.5.0

**`remove`: uninstall a server from a profile.**

```bash
npx dsh-mcp-bridge remove memory --profile web
```

`add` without `remove` was half a feature: uninstalling meant hand-editing YAML in the patch layer,
which is exactly the shape people get wrong. `remove` finds the entry by server name or id, deletes
that one `- insert:` block, and leaves every other entry and the header comment untouched.
`--dry-run` shows the target without writing; an unknown name exits 2 and lists the entries that are
present.

CLI tests: 12 → 22 assertions, covering removal, `--dry-run`, and the unknown-entry path.

## 0.4.0

**`add`: install any MCP server, not only the catalog.**

```bash
npx dsh-mcp-bridge add @modelcontextprotocol/server-memory
```

Writes a real entry into the profile's patch layer with the same renderer `init` uses, then starts
the server, completes the MCP handshake and reports the tool count — so the result is "it works" or
"it failed at <stage>: <reason>", not "a line was written". A failed probe keeps the entry so it can
be fixed in place, and the message names the file.

Options: `--profile`, `--name`, `--args`, `--env`, `--timeout`. Server names are derived from
the package (`@modelcontextprotocol/server-memory` → `memory`) unless overridden.

The CLI now has offline tests (12 assertions) covering entry writing, name derivation, `--env`
rendering, exit codes and the failure message, wired into CI as a separate step.

## [0.2.0] - 2026-09-22

### Added

- **CLI installer** (`dsh-mcp-bridge` bin): `init` (interactive server picker that
  writes real `insert:` entries into a profile's user patch layer), `list`
  (catalog + verification status) and `validate` (inspect a profile's MCP entries).
- Entry generation handles `insert:` semantics and config nesting correctly
  (verified by parsing the generated patch with `dsh --dump-config`).
- Family navigation line in both READMEs.
- Expanded npm keywords.


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
