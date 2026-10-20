#!/usr/bin/env node
// Single-server handshake probe for troubleshooting (stdio or streamable-http).
//
// Usage:
//   node scripts/probe-server.mjs                                   # default everything server
//   node scripts/probe-server.mjs npx -y your-mcp-server-package    # custom stdio server
//   MCP_URL=http://localhost:3000/mcp node scripts/probe-server.mjs # http server
//   node scripts/probe-server.mjs --json -- npx -y <package>        # machine-readable result
//
// The `doctor` command consumes the JSON form. Stages are reported separately because the useful
// part of a failure is *where* it happened: a server that never starts and a server that starts but
// cannot answer `tools/list` need different advice.
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Strip our own flags so they are not mistaken for the server command. */
const rawArgv = process.argv.slice(2)
const asJson = rawArgv.includes('--json')
const argv = rawArgv.filter((a) => a !== '--json' && a !== '--')

async function resolveSdkModule(rel) {
  const fromDir = (dir) => {
    const esm = path.join(dir, 'dist', 'esm', rel)
    if (existsSync(esm)) return pathToFileURL(esm).href
    return pathToFileURL(path.join(dir, 'dist', 'cjs', rel)).href
  }
  try {
    // Resolve the subpath, not the package root: the SDK's exports map has no "."
    // entry, so root resolution throws ERR_PACKAGE_PATH_NOT_EXPORTED.
    return pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${rel}`)).href
  } catch {
    /* fall through */
  }
  try {
    const pnpmDir = path.join(root, 'node_modules', '.pnpm')
    const sdkEntry = (await readdir(pnpmDir)).find((e) => e.startsWith('@modelcontextprotocol+sdk@'))
    if (sdkEntry) {
      const sdkReal = path.join(pnpmDir, sdkEntry, 'node_modules', '@modelcontextprotocol', 'sdk')
      return fromDir(sdkReal)
    }
  } catch {
    /* fall through */
  }
  try {
    const anchor = path.dirname(require.resolve('@deepseek-ai/dsh-mcp-client/package.json'))
    return fromDir(path.dirname(require.resolve('@modelcontextprotocol/sdk', { paths: [anchor] })))
  } catch {
    /* fall through */
  }
  throw new Error('Cannot locate @modelcontextprotocol/sdk — run `npm install` in this package first.')
}

const started = Date.now()
/** Emit one result object, then exit. Human-readable output stays on stderr. */
function finish(result) {
  const payload = { ...result, ms: Date.now() - started }
  if (asJson) console.log(JSON.stringify(payload))
  else if (!result.ok) console.error('[FAILED]', result.error)
  process.exit(result.ok ? 0 : 1)
}

let stage = 'resolve-sdk'
let client

try {
  const { StdioClientTransport } = await import(await resolveSdkModule('client/stdio.js'))
  const { Client } = await import(await resolveSdkModule('client/index.js'))

  client = new Client({ name: 'probe', version: '1.0.0' })
  let transport

  stage = 'connect'
  if (process.env.MCP_URL) {
    const { StreamableHTTPClientTransport } = await import(await resolveSdkModule('client/streamableHttp.js'))
    transport = new StreamableHTTPClientTransport(new URL(process.env.MCP_URL))
    console.error(`[1] connecting to ${process.env.MCP_URL} ...`)
  } else {
    const command = argv[0] ?? 'npx'
    const serverArgs = argv.length > 1 ? argv.slice(1) : ['-y', '@modelcontextprotocol/server-everything']
    transport = new StdioClientTransport({ command, args: serverArgs })
    console.error(`[1] connecting to ${command} ${serverArgs.join(' ')} ...`)
  }
  transport.onerror = (err) => console.error('[transport error]', err?.message ?? err)

  await client.connect(transport)
  // Reaching here means the process started and completed the MCP handshake.
  console.error('[2] connected OK')

  stage = 'tools'
  const tools = await client.listTools()
  console.error(`[3] tools listed: ${tools.tools.length}`)
  for (const t of tools.tools) {
    console.error(`    - ${t.name}: ${t.description ?? ''}`.slice(0, 120))
  }

  await client.close()
  console.error('[4] done')
  finish({
    ok: true,
    stage: 'done',
    toolCount: tools.tools.length,
    tools: tools.tools.map((t) => t.name),
  })
} catch (err) {
  await client?.close().catch(() => {})
  finish({ ok: false, stage, error: err?.message ? String(err.message) : String(err) })
}
