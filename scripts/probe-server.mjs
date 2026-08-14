#!/usr/bin/env node
// Single-server handshake probe for troubleshooting (stdio or streamable-http).
// Usage:
//   node scripts/probe-server.mjs                                   # default everything server
//   node scripts/probe-server.mjs npx -y your-mcp-server-package    # custom stdio server
//   MCP_URL=http://localhost:3000/mcp node scripts/probe-server.mjs # http server
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  throw new Error('Cannot locate @modelcontextprotocol/sdk — run `npm install` in this package first.')
}

const { StdioClientTransport } = await import(await resolveSdkModule('client/stdio.js'))
const { Client } = await import(await resolveSdkModule('client/index.js'))

const argv = process.argv.slice(2)
const client = new Client({ name: 'probe', version: '1.0.0' })
let transport

try {
  if (process.env.MCP_URL) {
    const { StreamableHTTPClientTransport } = await import(resolveSdkModule('client/streamableHttp.js'))
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
  console.error('[2] connected OK')
  const tools = await client.listTools()
  console.error(`[3] tools listed: ${tools.tools.length}`)
  for (const t of tools.tools) {
    console.error(`    - ${t.name}: ${t.description ?? ''}`.slice(0, 120))
  }
  await client.close()
  console.error('[4] done')
  process.exit(0)
} catch (err) {
  await client.close().catch(() => {})
  console.error('[FAILED]', err?.message ?? err)
  process.exit(1)
}
