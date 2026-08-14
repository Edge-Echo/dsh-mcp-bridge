#!/usr/bin/env node
// Batch connectivity verifier for the curated servers in ../servers/*.json.
// PASS  = connected and tools listed
// SKIP  = needs config / missing env / not applicable (see detail)
// FAIL  = connection or discovery failed (exit code 1)
//
// Usage:
//   node scripts/verify-servers.mjs
//   VERIFY_TIMEOUT_MS=15000 node scripts/verify-servers.mjs
//
// The MCP SDK is located through the dependency tree of
// @deepseek-ai/dsh-mcp-client, so no extra install is needed at runtime.
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Resolve one SDK module (e.g. 'client/stdio.js').
 * Tries, in order:
 *  1. plain resolution from this package (npm/yarn layout, or hoisted SDK);
 *  2. pnpm virtual store scan for @modelcontextprotocol+sdk@*;
 *  3. resolution anchored at @deepseek-ai/dsh-mcp-client's package dir.
 */
async function resolveSdkModule(rel) {
  const fromDir = (dir) => {
    const esm = path.join(dir, 'dist', 'esm', rel)
    if (existsSync(esm)) return pathToFileURL(esm).href
    return pathToFileURL(path.join(dir, 'dist', 'cjs', rel)).href
  }
  try {
    return fromDir(path.dirname(require.resolve('@modelcontextprotocol/sdk')))
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
  throw new Error('Cannot locate @modelcontextprotocol/sdk — run `npm install` in this package (it is a dependency of @deepseek-ai/dsh-mcp-client).')
}

const { StdioClientTransport } = await import(await resolveSdkModule('client/stdio.js'))
const { Client } = await import(await resolveSdkModule('client/index.js'))

/** Substitute ${ENV_VAR} references in a plain value. */
function expand(value) {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? '')
}

async function verifyOne(def, timeoutMs) {
  if (def.verify?.status === 'needs-config') {
    return { def, result: 'SKIP', detail: def.verify.note ?? 'needs config' }
  }
  const missing = (def.requiredEnv ?? []).filter((k) => !process.env[k])
  if (missing.length) return { def, result: 'SKIP', detail: `missing env: ${missing.join(', ')}` }

  const client = new Client({ name: 'dsh-mcp-bridge-verify', version: '1.0.0' })
  let transport
  try {
    if (def.transport === 'stdio') {
      const env = {}
      for (const [k, v] of Object.entries(def.env ?? {})) env[k] = expand(v)
      transport = new StdioClientTransport({ command: def.command, args: def.args, env })
    } else if (def.transport === 'streamable-http') {
      const headers = {}
      for (const [k, v] of Object.entries(def.headers ?? {})) headers[k] = expand(v)
      const { StreamableHTTPClientTransport } = await import(await resolveSdkModule('client/streamableHttp.js'))
      transport = new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers } })
    } else {
      return { def, result: 'SKIP', detail: `unknown transport: ${def.transport}` }
    }

    const outcome = await Promise.race([
      (async () => {
        await client.connect(transport)
        const tools = await client.listTools()
        return { ok: true, toolCount: tools.tools.length }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    await client.close().catch(() => {})
    return { def, result: 'PASS', detail: `${outcome.toolCount} tools` }
  } catch (err) {
    await client.close().catch(() => {})
    return { def, result: 'FAIL', detail: (err?.message ?? String(err)).slice(0, 120) }
  }
}

const timeoutMs = Number(process.env.VERIFY_TIMEOUT_MS ?? 30000)
const dir = path.join(root, 'servers')
const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()

const results = []
for (const file of files) {
  const def = JSON.parse(await readFile(path.join(dir, file), 'utf8'))
  results.push(await verifyOne(def, timeoutMs))
}

console.log('')
for (const { def, result, detail } of results) {
  console.log(`${result.padEnd(4)}  ${def.serverName.padEnd(14)} ${(detail ?? '').slice(0, 90)}`)
}

const failed = results.filter((r) => r.result === 'FAIL')
const passed = results.filter((r) => r.result === 'PASS')
console.log(`\n${passed.length} passed, ${results.filter((r) => r.result === 'SKIP').length} skipped, ${failed.length} failed`)
if (failed.length > 0) {
  console.error(`\n${failed.length} server(s) FAILED — fix before release.`)
  process.exit(1)
}
