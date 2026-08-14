# dsh-mcp-bridge

![dsh-mcp-bridge](https://raw.githubusercontent.com/Edge-Echo/dsh-mcp-bridge/main/banner.svg)

[![npm version](https://img.shields.io/npm/v/dsh-mcp-bridge?color=4d6bfe&logo=npm)](https://www.npmjs.com/package/dsh-mcp-bridge)
[![npm downloads](https://img.shields.io/npm/dm/dsh-mcp-bridge?color=22d3ee)](https://www.npmjs.com/package/dsh-mcp-bridge)
[![license](https://img.shields.io/npm/l/dsh-mcp-bridge?color=4d6bfe)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/Edge-Echo/dsh-mcp-bridge?color=22d3ee)](https://github.com/Edge-Echo/dsh-mcp-bridge)

**Curated, verified MCP server bundle for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

One install gives your dsh agent a set of battle-tested MCP servers — not a raw YAML you have to figure out. Every curated server has a machine-readable definition in `servers/`, and `scripts/verify-servers.mjs` checks each one's connectivity, so "verified" is a CI-guaranteed claim, not marketing.

Tools appear to the model as `mcp__<serverName>__<toolName>` (same server-qualified shape as Claude Code / Codex). The bridge itself is DSH's built-in [`@deepseek-ai/dsh-mcp-client`](https://github.com/deepseek-ai/deepseek-harness): stdio + streamable-http, auto-reconnect, HMR hot-swap.

> 中文文档见 [README.zh.md](README.zh.md)。

## Quick start

Prereqs: `dsh` and `pnpm` on PATH (`dsh plugin` forwards to pnpm; install with `npm i -g pnpm`).

```sh
dsh plugin --profile web add dsh-mcp-bridge
# local checkout:  dsh plugin --profile web add ./dsh-mcp-bridge
dsh web        # restart the profile
```

The demo server (MCP official `everything`) is enabled by default — no API key, pure local `npx`. After restart, ask your model to "call the everything server's echo tool with hello" and it should use `mcp__everything__echo`.

> First run downloads the server packages via `npx`; subsequent runs are cached.

## Curated catalog

| Server | What it gives you | Config needed | Verified |
|---|---|---|---|
| `everything` | Demo tools: echo, add, long-running ops, tiny image | none (default on) | ✅ 13 tools |
| `memory` | In-session knowledge graph (entities/relations) | none | ✅ 9 tools |
| `filesystem` | File read/write/search, **scoped to explicit roots** | root dir (edit args) | ✅ 14 tools (given a real dir) |
| `github` | Repos / issues / PRs | `GITHUB_TOKEN` | ⏸ needs config |
| `playwright` | Browser automation (navigate/click/screenshot) | first-run browser download | ⏸ heavy, excluded from CI |
| `remote-http` | Your own / hosted HTTP MCP server | URL (+ optional token) | ⏸ needs config |

To enable a commented preset, uncomment its block in the profile's `cordis.patch.yml` (hot-reloaded via HMR) or edit `cordis.patch.yml` in this package.

## Verify the catalog yourself

```sh
npm install          # brings @deepseek-ai/dsh-mcp-client → the MCP SDK
npm run verify       # or: node scripts/verify-servers.mjs
```

Prints `PASS` / `SKIP` / `FAIL` per server; exits non-zero on any failure. `VERIFY_TIMEOUT_MS=15000` tunes the per-server timeout. Single-server troubleshooting: `node scripts/probe-server.mjs npx -y your-mcp-server`.

## Adding your own MCP server

Each server is one `@deepseek-ai/dsh-mcp-client` entry. Either add it to the profile's user patch layer (recommended, HMR applies it without restart):

```yaml
# $DSH_HOME/profiles/<name>/cordis.patch.yml
- id: mcp-myserver
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: myserver          # namespace, unique per process ([A-Za-z0-9_-]{1,32})
    transport: stdio              # or streamable-http
    command: npx
    args: ['-y', 'your-mcp-server']
    env:
      YOUR_TOKEN: !!js process.env.YOUR_TOKEN
```

…or drop a definition into `servers/` (so `verify` covers it) and add the matching entry to `cordis.patch.yml` here.

### Config fields (from dsh-mcp-client)

| Field | Transports | Required | Meaning |
|---|---|---|---|
| `transport` | both | yes | `"stdio"` or `"streamable-http"` |
| `serverName` | both | yes | tool namespace, unique among live instances |
| `command` / `args` / `env` / `cwd` | stdio | command yes | child process spec |
| `url` / `headers` | http | url yes | endpoint + auth headers |
| `toolCallTimeoutMs` | both | no | per-call timeout, default 60000 |
| `failOnStartupError` | both | no | reject activation on connect failure (default `false`) |
| `reconnect.*` | both | no | auto-reconnect backoff (default on) |

## Linking up with Reasonix / CodeWhale

All three are agent harnesses — **MCP is the shared language**. Any server you run for Reasonix or CodeWhale can be added here, and a local `streamable-http` server you own can serve DSH, Reasonix and CodeWhale from one process. See `servers/remote-http.json`.

## Troubleshooting (Windows)

- **Headless verification hangs** (`dsh --profile <name> "task"`): the profile needs `@deepseek-ai/dsh-headless` in `dsh.profile.bundles` (add it manually; `dsh plugin add @deepseek-ai/dsh-headless` fails with 404 on its unpublished dependency). Without it the tree activates but no agent consumes the task.
- **`npx` is fine on Windows**: the MCP SDK uses `cross-spawn`, which resolves `.cmd` shims — no `npx.exe` needed.
- **Server connects but no tools**: check the profile logs; `failOnStartupError: false` means the entry activates without tools on failure.

## Releasing (npm)

1. `npm version patch` (or bump `package.json` manually), commit, tag `vX.Y.Z`.
2. `git push origin main --tags`.
3. GitHub Actions (`publish.yml`) publishes to npm — requires npm **trusted publisher** (OIDC) linked to the repo. Setup: npm → Access Tokens → Generate new token → *Publish with GitHub Actions*.

Give the repo the GitHub topic **`dsh-plugin`** so it shows up in the community lists ([awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), [WhaleHub](https://github.com/vvlife/whalehub-dsh)).

## License

MIT — see [LICENSE](LICENSE).
