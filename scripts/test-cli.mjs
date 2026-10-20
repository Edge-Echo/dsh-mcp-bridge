// CLI tests for `add`: the entry-writing path, name derivation, and exit-code semantics.
//
// The probe is allowed to fail here (a bogus package is used on purpose, with a short timeout), so
// the test is deterministic and offline: what it asserts is that the entry is still written, that
// the failure is reported with the patch path, and that the exit code says so.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'lib', 'cli.js')

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
  if (!ok) failures++
}

const home = mkdtempSync(join(tmpdir(), 'mcp-bridge-cli-'))
mkdirSync(join(home, 'profiles', 'web'), { recursive: true })

const run = (args) => {
  try {
    const out = execFileSync(process.execPath, [cli, ...args], {
      env: { ...process.env, DSH_HOME: home },
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
  }
}

try {
  // ── help ────────────────────────────────────────────────────────────────
  const help = run(['--help'])
  check('help lists the add command', help.out.includes('add <npm-package>'))
  check('help explains what add is for', help.out.includes('not in the catalog'))

  // ── a package that cannot start: entry still written, exit code 1 ───────
  const bogus = 'this-package-does-not-exist-xyz'
  const failed = run(['add', bogus, '--profile', 'web', '--timeout', '10'])
  const patchFile = join(home, 'profiles', 'web', 'cordis.patch.yml')
  const patch = readFileSync(patchFile, 'utf8')
  check('a failed probe still exits non-zero', failed.code === 1, `exit ${failed.code}`)
  check('the entry is written even when the probe fails', patch.includes('- id: custom-this-package-does-not-exist-xyz'))
  check('the failure names the patch file so it can be fixed', failed.out.includes('cordis.patch.yml'))
  check('the failure names the probe stage', /FAILED at \w+/.test(failed.out), (failed.out.match(/FAILED at \w+/) ?? [''])[0])
  check('the written entry uses insert semantics', patch.includes('- insert:'))
  check('the entry points at the MCP client plugin', patch.includes("name: '@deepseek-ai/dsh-mcp-client'"))

  // ── name derivation ─────────────────────────────────────────────────────
  run(['add', '@modelcontextprotocol/server-memory', '--profile', 'web', '--timeout', '10'])
  const afterDerived = readFileSync(patchFile, 'utf8')
  check(
    'server name is derived from the package (@scope/server-memory -> memory)',
    afterDerived.includes('- id: custom-memory'),
    afterDerived.includes('- id: custom-memory') ? 'memory' : 'not derived',
  )

  // ── explicit name wins ──────────────────────────────────────────────────
  run(['add', '@modelcontextprotocol/server-memory', '--profile', 'web', '--name', 'mem2', '--timeout', '10'])
  const afterNamed = readFileSync(patchFile, 'utf8')
  check('--name overrides the derived name', afterNamed.includes('- id: custom-mem2'))
  check('both entries coexist', afterNamed.includes('custom-memory') && afterNamed.includes('custom-mem2'))

  // ── --env renders the env map the client plugin expects ────────────────
  run(['add', 'some-package', '--profile', 'web', '--name', 'withenv', '--env', 'SOME_KEY', '--timeout', '10'])
  const afterEnv = readFileSync(patchFile, 'utf8')
  check(
    '--env is written as a process.env reference, not a literal',
    /SOME_KEY: !!js process\.env\.SOME_KEY/.test(afterEnv),
    (afterEnv.match(/SOME_KEY: .*/) ?? [''])[0].trim(),
  )
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
