#!/usr/bin/env node
// dsh-mcp-bridge CLI — the install experience the YAML presets could not give.
//
//   dsh-mcp-bridge list                      show the curated catalog
//   dsh-mcp-bridge init [options]            interactive installer
//   dsh-mcp-bridge validate [--profile web]  check the servers in a profile
//
// `init` writes real entries into a profile's user patch layer
// ($DSH_HOME/profiles/<name>/cordis.patch.yml), so the choice survives
// plugin upgrades instead of being lost with the bundle's own patch file.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const HERE = dirname(fileURLToPath(import.meta.url))

/** One curated server definition from servers/*.json. */
interface ServerDef {
  id: string
  serverName: string
  title: string
  description: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  requiredEnv?: string[]
  verify?: { status?: string; note?: string }
}

interface Args {
  command: string
  profile?: string
  servers: string[]
  yes: boolean
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: '', servers: [], yes: false, json: false }
  const rest = [...argv]
  out.command = rest.shift() ?? ''
  while (rest.length) {
    const t = rest.shift()!
    switch (t) {
      case '--profile': case '-p': out.profile = rest.shift(); break
      case '--servers': case '-s': out.servers = (rest.shift() ?? '').split(',').map((s) => s.trim()).filter(Boolean); break
      case '--yes': case '-y': out.yes = true; break
      case '--json': out.json = true; break
      case '--help': case '-h': out.command = '--help'; break
      case '--version': case '-v': out.command = '--version'; break
      default:
        if (t.startsWith('--')) { console.error(`Unknown option: ${t}`); process.exit(2) }
    }
  }
  return out
}

const HELP = `dsh-mcp-bridge — curated, verified MCP servers for DeepSeek Harness

Usage:
  dsh-mcp-bridge list [--json]
      Show the curated server catalog with verification status.

  dsh-mcp-bridge init [--profile <name>] [--servers a,b,c] [--yes]
      Interactive installer: pick servers, then write real entries into the
      profile's user patch layer ($DSH_HOME/profiles/<name>/cordis.patch.yml).

  dsh-mcp-bridge validate [--profile <name>]
      Check the MCP entries already present in a profile (connection test).

Examples:
  dsh-mcp-bridge list
  dsh-mcp-bridge init
  dsh-mcp-bridge init --profile web --servers everything,memory --yes
`

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Load the curated catalog shipped in servers/*.json. */
export function loadCatalog(): ServerDef[] {
  const dir = join(HERE, '..', 'servers')
  const out: ServerDef[] = []
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return out
  }
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')) as ServerDef)
    } catch { /* skip malformed catalog entry */ }
  }
  return out.sort((a, b) => a.serverName.localeCompare(b.serverName))
}

/** List profiles under $DSH_HOME/profiles. */
export function listProfiles(home = dshHome()): string[] {
  const dir = join(home, 'profiles')
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'node_modules')
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * Render one catalog entry as a cordis.patch.yml loader entry.
 *
 * The user patch layer is applied ON TOP of the composed bundle tree, where a
 * bare `- id:` entry means "override that existing entry" — naming a new id
 * that way produces `patch: entry "x" not found` and does nothing. New entries
 * must go through `insert:`.
 */
export function renderEntry(def: ServerDef): string {
  const E = '    ' // 4: list item under `- insert:`
  const F = '      ' // 6: entry fields (id/name/config) under that item
  const C = '        ' // 8: config fields
  const L = '          ' // 10: list items (args) and env map entries
  const lines: string[] = []
  lines.push('- insert:')
  lines.push(`${E}- id: ${def.id}`)
  lines.push(`${F}name: '@deepseek-ai/dsh-mcp-client'`)
  lines.push(`${F}config:`)
  lines.push(`${C}serverName: ${def.serverName}`)
  lines.push(`${C}transport: ${def.transport}`)
  if (def.transport === 'stdio') {
    lines.push(`${C}command: ${def.command ?? 'npx'}`)
    const args = def.args ?? []
    if (args.length) {
      lines.push(`${C}args:`)
      for (const a of args) lines.push(`${L}- '${a}'`)
    }
    const envKeys = Object.keys(def.env ?? {})
    if (envKeys.length) {
      lines.push(`${C}env:`)
      for (const k of envKeys) {
        const raw = def.env![k] ?? ''
        const m = /^\$\{([A-Z0-9_]+)\}$/.exec(raw)
        lines.push(`${L}${k}: ${m ? `!!js process.env.${m[1]}` : `'${raw}'`}`)
      }
    }
  } else {
    lines.push(`${C}url: '${def.url ?? 'http://localhost:3000/mcp'}'`)
    const hk = Object.keys(def.headers ?? {})
    if (hk.length) {
      lines.push(`${C}headers:`)
      for (const k of hk) {
        const raw = def.headers![k] ?? ''
        const m = /^Bearer \$\{([A-Z0-9_]+)\}$/.exec(raw)
        lines.push(`${L}${k}: ${m ? `!!js '` + '`Bearer ${process.env.' + m[1] + '}`' + `'` : `'${raw}'`}`)
      }
    }
  }
  return lines.join('\n')
}

/** Merge new entries into an existing patch file, preserving user content. */
export function writePatchFile(file: string, entries: string[]): { created: boolean; appended: number } {
  // Top-level YAML array: entries are separated by a blank line for readability.
  const block = entries.join('\n\n')
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `# dsh-mcp-bridge: servers installed by \`dsh-mcp-bridge init\`\n${block}\n`, 'utf8')
    return { created: true, appended: entries.length }
  }
  const current = readFileSync(file, 'utf8')
  if (/^\s*(#.*\n)*\s*\[\s*\]\s*$/m.test(current.trim())) {
    writeFileSync(file, `${current.trimEnd().replace(/\[\s*\]\s*$/, '')}\n${block}\n`, 'utf8')
    return { created: false, appended: entries.length }
  }
  writeFileSync(file, `${current.trimEnd()}\n\n${block}\n`, 'utf8')
  return { created: false, appended: entries.length }
}

function statusIcon(def: ServerDef): string {
  const s = def.verify?.status
  if (s === 'verified') return '✅ verified'
  if (s === 'needs-config') return '⏸ needs config'
  return '· untested'
}

async function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return (await rl.question(question)).trim()
}

async function cmdInit(args: Args): Promise<number> {
  const catalog = loadCatalog()
  if (!catalog.length) { console.error('No catalog entries found (servers/*.json missing).'); return 1 }
  const profiles = listProfiles()
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    let profile = args.profile
    if (!profile) {
      if (!profiles.length) { console.error(`No profiles found under ${join(dshHome(), 'profiles')}. Create one first (e.g. \`dsh plugin --profile web add dsh-mcp-bridge\`).`); return 1 }
      console.log('Profiles found:')
      profiles.forEach((p, i) => console.log(`  ${i + 1}) ${p}`))
      const answer = await ask(rl, `Install into which profile? [${profiles[0]}] `)
      if (answer) {
        const idx = Number(answer)
        profile = Number.isFinite(idx) && idx >= 1 && idx <= profiles.length ? profiles[idx - 1]! : answer
      } else {
        profile = profiles[0]!
      }
    }

    let chosen: ServerDef[]
    if (args.servers.length) {
      chosen = catalog.filter((d) => args.servers.includes(d.serverName) || args.servers.includes(d.id))
      const missing = args.servers.filter((s) => !chosen.some((d) => d.serverName === s || d.id === s))
      if (missing.length) console.warn(`Unknown server(s): ${missing.join(', ')}`)
    } else if (args.yes) {
      chosen = catalog.filter((d) => (d.verify?.status ?? '') === 'verified' || !d.requiredEnv?.length)
    } else {
      console.log('\nAvailable MCP servers:\n')
      catalog.forEach((d, i) => {
        const env = d.requiredEnv?.length ? ` (needs ${d.requiredEnv.join(', ')})` : ''
        console.log(`  ${String(i + 1).padStart(2)}) ${d.serverName.padEnd(14)} ${statusIcon(d)}${env}`)
        console.log(`      ${d.description}`)
      })
      const defaults = catalog.map((d, i) => (d.serverName === 'everything' ? i + 1 : 0)).filter(Boolean)
      const answer = await ask(rl, `\nSelect servers (comma-separated numbers) [${defaults.join(',')}]: `)
      const nums = (answer || defaults.join(','))
        .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 1 && n <= catalog.length)
      chosen = nums.map((n) => catalog[n - 1]!)
    }

    if (!chosen.length) { console.error('No servers selected — nothing to do.'); return 1 }

    const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml')
    const cwd = process.cwd()
    const entries = chosen.map((d) => renderEntry(d))
    const result = writePatchFile(patchFile, entries)

    console.log('')
    console.log(`✅ Wrote ${result.appended} server entr${result.appended === 1 ? 'y' : 'ies'} to ${patchFile}${result.created ? ' (created)' : ''}`)
    const needsEnv = chosen.filter((d) => d.requiredEnv?.length)
    for (const d of needsEnv) {
      console.log(`   ⚠ ${d.serverName} needs env: ${d.requiredEnv!.join(', ')}`)
    }
    const needsPath = chosen.filter((d) => (d.args ?? []).some((a) => a.includes('/path/to/')))
    for (const d of needsPath) {
      console.log(`   ⚠ ${d.serverName} has a placeholder path in args — edit ${patchFile} before restarting`)
    }
    console.log('')
    console.log('Next steps:')
    console.log(`  1. dsh plugin --profile ${profile} add dsh-mcp-bridge   # if not installed yet`)
    console.log(`  2. restart the profile (e.g. \`dsh ${profile === 'web' ? 'web' : `--profile ${profile}`}\`)`)
    console.log(`  3. verify: dsh-mcp-bridge validate --profile ${profile}`)
    if (cwd) console.log(`\n(entry paths above are absolute; your cwd was ${cwd})`)
    return 0
  } finally {
    rl.close()
  }
}

/** Parse the mcp-client entries currently present in a profile's patch layer. */
export function readProfileServers(profile: string): { id: string; serverName: string; transport: string }[] {
  const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml')
  if (!existsSync(patchFile)) return []
  const text = readFileSync(patchFile, 'utf8')
  const out: { id: string; serverName: string; transport: string }[] = []
  const re = /-\s*id:\s*(\S+)[\s\S]*?serverName:\s*(\S+)[\s\S]*?transport:\s*(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push({ id: m[1]!, serverName: m[2]!, transport: m[3]! })
  return out
}

async function cmdValidate(args: Args): Promise<number> {
  const profiles = args.profile ? [args.profile] : listProfiles()
  const catalog = loadCatalog()
  let checked = 0
  for (const profile of profiles) {
    const servers = readProfileServers(profile)
    if (!servers.length) continue
    console.log(`\nProfile ${profile}: ${servers.length} MCP entr${servers.length === 1 ? 'y' : 'ies'}`)
    for (const s of servers) {
      const def = catalog.find((d) => d.serverName === s.serverName)
      const icon = def?.verify?.status === 'verified' ? '✅' : '·'
      console.log(`  ${icon} ${s.serverName.padEnd(14)} ${s.transport.padEnd(16)} ${def?.title ?? '(not in catalog)'}`)
      checked++
    }
  }
  if (!checked) { console.log('No MCP entries found in any profile patch layer.'); return 0 }
  console.log(`\n${checked} entr${checked === 1 ? 'y' : 'ies'} listed. For a live connection test run:`)
  console.log('  node scripts/verify-servers.mjs   (inside the dsh-mcp-bridge package)')
  return 0
}

function cmdList(args: Args): number {
  const catalog = loadCatalog()
  if (args.json) { console.log(JSON.stringify(catalog, null, 2)); return 0 }
  console.log(`${catalog.length} curated MCP server(s):\n`)
  for (const d of catalog) {
    const env = d.requiredEnv?.length ? `  (needs ${d.requiredEnv.join(', ')})` : ''
    console.log(`  ${d.serverName.padEnd(14)} ${statusIcon(d)}${env}`)
    console.log(`      ${d.description}`)
  }
  return 0
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === '--version') {
    const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as { version: string }
    console.log(pkg.version)
    return 0
  }
  if (args.command === '' || args.command === '--help' || args.command === 'help') {
    console.log(HELP)
    return args.command === '' ? 2 : 0
  }
  switch (args.command) {
    case 'list': return cmdList(args)
    case 'init': return await cmdInit(args)
    case 'validate': return await cmdValidate(args)
    default:
      console.error(`Unknown command: ${args.command}\n`)
      console.log(HELP)
      return 2
  }
}

// Only run when executed directly (allows unit-testing the exports).
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exit(await main())
}
