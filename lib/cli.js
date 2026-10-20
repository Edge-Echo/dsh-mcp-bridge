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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
const HERE = dirname(fileURLToPath(import.meta.url));
function parseArgs(argv) {
    const out = { command: '', positional: [], servers: [], extraArgs: [], envNames: [], yes: false, json: false, timeoutMs: 60_000, dryRun: false };
    const rest = [...argv];
    out.command = rest.shift() ?? '';
    while (rest.length) {
        const t = rest.shift();
        switch (t) {
            case '--profile':
            case '-p':
                out.profile = rest.shift();
                break;
            case '--servers':
            case '-s':
                out.servers = (rest.shift() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                break;
            case '--yes':
            case '-y':
                out.yes = true;
                break;
            case '--json':
                out.json = true;
                break;
            case '--dry-run':
                out.dryRun = true;
                break;
            case '--name':
                out.name = rest.shift();
                break;
            case '--args':
                out.extraArgs = (rest.shift() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                break;
            case '--env':
                out.envNames = (rest.shift() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                break;
            case '--timeout': {
                const secs = Number(rest.shift() ?? '60');
                if (!Number.isFinite(secs) || secs <= 0) {
                    console.error('--timeout expects a positive number of seconds');
                    process.exit(2);
                }
                out.timeoutMs = secs * 1000;
                break;
            }
            case '--help':
            case '-h':
                out.command = '--help';
                break;
            case '--version':
            case '-v':
                out.command = '--version';
                break;
            default:
                if (t.startsWith('--')) {
                    console.error(`Unknown option: ${t}`);
                    process.exit(2);
                }
                out.positional.push(t);
        }
    }
    return out;
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

  dsh-mcp-bridge doctor [--servers a,b,c] [--timeout <seconds>] [--json]
      Start each curated server, complete the MCP handshake, list its tools, and
      report where it broke when it breaks. Skips servers whose required
      environment variables are unset instead of calling that a failure.

Examples:
  dsh-mcp-bridge list
  dsh-mcp-bridge init
  dsh-mcp-bridge init --profile web --servers everything,memory --yes
  dsh-mcp-bridge doctor
  dsh-mcp-bridge doctor --servers playwright --timeout 90
  dsh-mcp-bridge add <npm-package> [--profile <name>] [--name <serverName>]
      Install an MCP server that is not in the catalog, then probe it.

  dsh-mcp-bridge add @modelcontextprotocol/server-memory
  dsh-mcp-bridge add some-mcp-server --name some --env SOME_API_KEY

  dsh-mcp-bridge remove <serverName> [--profile <name>] [--dry-run]
      Remove a server entry from a profile patch layer.

  dsh-mcp-bridge remove memory --profile web
`;
export function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/** Load the curated catalog shipped in servers/*.json. */
export function loadCatalog() {
    const dir = join(HERE, '..', 'servers');
    const out = [];
    let files;
    try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    }
    catch {
        return out;
    }
    for (const f of files) {
        try {
            out.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
        }
        catch { /* skip malformed catalog entry */ }
    }
    return out.sort((a, b) => a.serverName.localeCompare(b.serverName));
}
/** List profiles under $DSH_HOME/profiles. */
export function listProfiles(home = dshHome()) {
    const dir = join(home, 'profiles');
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && e.name !== 'node_modules')
            .map((e) => e.name)
            .sort();
    }
    catch {
        return [];
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
export function renderEntry(def) {
    const E = '    '; // 4: list item under `- insert:`
    const F = '      '; // 6: entry fields (id/name/config) under that item
    const C = '        '; // 8: config fields
    const L = '          '; // 10: list items (args) and env map entries
    const lines = [];
    lines.push('- insert:');
    lines.push(`${E}- id: ${def.id}`);
    lines.push(`${F}name: '@deepseek-ai/dsh-mcp-client'`);
    lines.push(`${F}config:`);
    lines.push(`${C}serverName: ${def.serverName}`);
    lines.push(`${C}transport: ${def.transport}`);
    if (def.transport === 'stdio') {
        lines.push(`${C}command: ${def.command ?? 'npx'}`);
        const args = def.args ?? [];
        if (args.length) {
            lines.push(`${C}args:`);
            for (const a of args)
                lines.push(`${L}- '${a}'`);
        }
        const envKeys = Object.keys(def.env ?? {});
        if (envKeys.length) {
            lines.push(`${C}env:`);
            for (const k of envKeys) {
                const raw = def.env[k] ?? '';
                const m = /^\$\{([A-Z0-9_]+)\}$/.exec(raw);
                lines.push(`${L}${k}: ${m ? `!!js process.env.${m[1]}` : `'${raw}'`}`);
            }
        }
    }
    else {
        lines.push(`${C}url: '${def.url ?? 'http://localhost:3000/mcp'}'`);
        const hk = Object.keys(def.headers ?? {});
        if (hk.length) {
            lines.push(`${C}headers:`);
            for (const k of hk) {
                const raw = def.headers[k] ?? '';
                const m = /^Bearer \$\{([A-Z0-9_]+)\}$/.exec(raw);
                lines.push(`${L}${k}: ${m ? `!!js '` + '`Bearer ${process.env.' + m[1] + '}`' + `'` : `'${raw}'`}`);
            }
        }
    }
    return lines.join('\n');
}
/** Merge new entries into an existing patch file, preserving user content. */
export function writePatchFile(file, entries) {
    // Top-level YAML array: entries are separated by a blank line for readability.
    const block = entries.join('\n\n');
    if (!existsSync(file)) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `# dsh-mcp-bridge: servers installed by \`dsh-mcp-bridge init\`\n${block}\n`, 'utf8');
        return { created: true, appended: entries.length };
    }
    const current = readFileSync(file, 'utf8');
    if (/^\s*(#.*\n)*\s*\[\s*\]\s*$/m.test(current.trim())) {
        writeFileSync(file, `${current.trimEnd().replace(/\[\s*\]\s*$/, '')}\n${block}\n`, 'utf8');
        return { created: false, appended: entries.length };
    }
    writeFileSync(file, `${current.trimEnd()}\n\n${block}\n`, 'utf8');
    return { created: false, appended: entries.length };
}
function statusIcon(def) {
    const s = def.verify?.status;
    if (s === 'verified')
        return '✅ verified';
    if (s === 'needs-config')
        return '⏸ needs config';
    return '· untested';
}
async function ask(rl, question) {
    return (await rl.question(question)).trim();
}
async function cmdInit(args) {
    const catalog = loadCatalog();
    if (!catalog.length) {
        console.error('No catalog entries found (servers/*.json missing).');
        return 1;
    }
    const profiles = listProfiles();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        let profile = args.profile;
        if (!profile) {
            if (!profiles.length) {
                console.error(`No profiles found under ${join(dshHome(), 'profiles')}. Create one first (e.g. \`dsh plugin --profile web add dsh-mcp-bridge\`).`);
                return 1;
            }
            console.log('Profiles found:');
            profiles.forEach((p, i) => console.log(`  ${i + 1}) ${p}`));
            const answer = await ask(rl, `Install into which profile? [${profiles[0]}] `);
            if (answer) {
                const idx = Number(answer);
                profile = Number.isFinite(idx) && idx >= 1 && idx <= profiles.length ? profiles[idx - 1] : answer;
            }
            else {
                profile = profiles[0];
            }
        }
        let chosen;
        if (args.servers.length) {
            chosen = catalog.filter((d) => args.servers.includes(d.serverName) || args.servers.includes(d.id));
            const missing = args.servers.filter((s) => !chosen.some((d) => d.serverName === s || d.id === s));
            if (missing.length)
                console.warn(`Unknown server(s): ${missing.join(', ')}`);
        }
        else if (args.yes) {
            chosen = catalog.filter((d) => (d.verify?.status ?? '') === 'verified' || !d.requiredEnv?.length);
        }
        else {
            console.log('\nAvailable MCP servers:\n');
            catalog.forEach((d, i) => {
                const env = d.requiredEnv?.length ? ` (needs ${d.requiredEnv.join(', ')})` : '';
                console.log(`  ${String(i + 1).padStart(2)}) ${d.serverName.padEnd(14)} ${statusIcon(d)}${env}`);
                console.log(`      ${d.description}`);
            });
            const defaults = catalog.map((d, i) => (d.serverName === 'everything' ? i + 1 : 0)).filter(Boolean);
            const answer = await ask(rl, `\nSelect servers (comma-separated numbers) [${defaults.join(',')}]: `);
            const nums = (answer || defaults.join(','))
                .split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 1 && n <= catalog.length);
            chosen = nums.map((n) => catalog[n - 1]);
        }
        if (!chosen.length) {
            console.error('No servers selected — nothing to do.');
            return 1;
        }
        const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
        const cwd = process.cwd();
        const entries = chosen.map((d) => renderEntry(d));
        const result = writePatchFile(patchFile, entries);
        console.log('');
        console.log(`✅ Wrote ${result.appended} server entr${result.appended === 1 ? 'y' : 'ies'} to ${patchFile}${result.created ? ' (created)' : ''}`);
        const needsEnv = chosen.filter((d) => d.requiredEnv?.length);
        for (const d of needsEnv) {
            console.log(`   ⚠ ${d.serverName} needs env: ${d.requiredEnv.join(', ')}`);
        }
        const needsPath = chosen.filter((d) => (d.args ?? []).some((a) => a.includes('/path/to/')));
        for (const d of needsPath) {
            console.log(`   ⚠ ${d.serverName} has a placeholder path in args — edit ${patchFile} before restarting`);
        }
        console.log('');
        console.log('Next steps:');
        console.log(`  1. dsh plugin --profile ${profile} add dsh-mcp-bridge   # if not installed yet`);
        console.log(`  2. restart the profile (e.g. \`dsh ${profile === 'web' ? 'web' : `--profile ${profile}`}\`)`);
        console.log(`  3. verify: dsh-mcp-bridge validate --profile ${profile}`);
        if (cwd)
            console.log(`\n(entry paths above are absolute; your cwd was ${cwd})`);
        return 0;
    }
    finally {
        rl.close();
    }
}
/** Parse the mcp-client entries currently present in a profile's patch layer. */
export function readProfileServers(profile) {
    const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
    if (!existsSync(patchFile))
        return [];
    const text = readFileSync(patchFile, 'utf8');
    const out = [];
    const re = /-\s*id:\s*(\S+)[\s\S]*?serverName:\s*(\S+)[\s\S]*?transport:\s*(\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null)
        out.push({ id: m[1], serverName: m[2], transport: m[3] });
    return out;
}
async function cmdValidate(args) {
    const profiles = args.profile ? [args.profile] : listProfiles();
    const catalog = loadCatalog();
    let checked = 0;
    for (const profile of profiles) {
        const servers = readProfileServers(profile);
        if (!servers.length)
            continue;
        console.log(`\nProfile ${profile}: ${servers.length} MCP entr${servers.length === 1 ? 'y' : 'ies'}`);
        for (const s of servers) {
            const def = catalog.find((d) => d.serverName === s.serverName);
            const icon = def?.verify?.status === 'verified' ? '✅' : '·';
            console.log(`  ${icon} ${s.serverName.padEnd(14)} ${s.transport.padEnd(16)} ${def?.title ?? '(not in catalog)'}`);
            checked++;
        }
    }
    if (!checked) {
        console.log('No MCP entries found in any profile patch layer.');
        return 0;
    }
    console.log(`\n${checked} entr${checked === 1 ? 'y' : 'ies'} listed. For a live connection test run:`);
    console.log('  node scripts/verify-servers.mjs   (inside the dsh-mcp-bridge package)');
    return 0;
}
/** Name the probe stage in words a user can act on. */
function describeProbeStage(stage) {
    switch (stage) {
        case 'resolve-sdk': return 'the probe could not load the MCP SDK';
        case 'spawn': return 'the process could not be started';
        case 'connect': return 'the server did not complete the MCP handshake';
        case 'tools': return 'the handshake worked, but listing tools failed';
        default: return 'the probe failed';
    }
}
/** The concrete next step, which is the only reason to run a diagnostic at all. */
function adviceFor(def, stage, error) {
    const manual = [def.command, ...(def.args ?? [])].filter(Boolean).join(' ');
    if (error && /ENOENT|not recognized|not found/i.test(error)) {
        return `the command is not on PATH — run it yourself to see why: ${manual}`;
    }
    if (stage === 'connect')
        return `start it by hand and read its output: ${manual}`;
    if (stage === 'tools') {
        return `the package may target a different MCP SDK version — try its newest release, then: ${manual}`;
    }
    return `run it by hand to see the error: ${manual}`;
}
/** Start one stdio server, complete the MCP handshake and list its tools. */
function probeServer(def, command, timeoutMs) {
    const probe = join(HERE, '..', 'scripts', 'probe-server.mjs');
    return new Promise((resolveProbe) => {
        const child = spawn(process.execPath, [probe, command, ...(def.args ?? []), '--json'], {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        let stdout = '';
        let settled = false;
        const settle = (value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolveProbe(value);
        };
        const timer = setTimeout(() => {
            child.kill();
            settle({ ok: false, stage: 'connect', error: `no answer within ${Math.round(timeoutMs / 1000)}s` });
        }, timeoutMs);
        child.stdout.on('data', (d) => { stdout += String(d); });
        child.on('error', (err) => settle({ ok: false, stage: 'spawn', error: err.message }));
        child.on('close', () => {
            const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
            try {
                settle(JSON.parse(line));
            }
            catch {
                settle({ ok: false, stage: 'probe', error: 'the probe produced no result' });
            }
        });
    });
}
/** Derive a server name from an npm package: @scope/server-memory -> memory. */
function serverNameFromPackage(pkg) {
    const base = pkg.includes('/') ? pkg.slice(pkg.lastIndexOf('/') + 1) : pkg;
    return base
        .replace(/^@/, '')
        .replace(/^(server|mcp)[-_]?/, '')
        .replace(/[-_]?mcp$/, '')
        .replace(/[-_]?server$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .toLowerCase() || 'custom';
}
/**
 * Install an arbitrary npm-published MCP server into a profile and probe it.
 *
 * The curated catalog is the ceiling of init; this removes the ceiling without pretending the
 * result is "verified" — the probe reports what actually happened on this machine.
 */
async function cmdAdd(args) {
    const pkg = args.positional[0];
    if (!pkg) {
        console.error('Usage: dsh-mcp-bridge add <npm-package> [--profile <name>] [--name <serverName>] [--args a,b] [--env KEY1,KEY2]');
        return 2;
    }
    const profiles = listProfiles();
    const profile = args.profile ?? profiles[0];
    if (!profile) {
        console.error(`No profiles found under ${join(dshHome(), 'profiles')}. Create one first (e.g. \`dsh plugin --profile web add dsh-mcp-bridge\`).`);
        return 1;
    }
    const serverName = args.name ?? serverNameFromPackage(pkg);
    const def = {
        id: `custom-${serverName}`,
        serverName,
        title: pkg,
        description: `Installed by dsh-mcp-bridge add: ${pkg}`,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', pkg, ...args.extraArgs],
        env: Object.fromEntries(args.envNames.map((k) => [k, '${' + k + '}'])),
        requiredEnv: args.envNames,
    };
    const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
    const result = writePatchFile(patchFile, [renderEntry(def)]);
    console.log(`Wrote ${def.serverName} (${pkg}) to ${patchFile}${result.created ? ' (created)' : ''}`);
    if (args.envNames.length) {
        console.log(`  env required: ${args.envNames.join(', ')} (read from the environment at profile start)`);
    }
    if (args.json) {
        console.log(JSON.stringify({ profile, patchFile, serverName, package: pkg, probe: null }));
        return 0;
    }
    console.log(`\nChecking that it actually starts...`);
    const missing = (def.requiredEnv ?? []).filter((k) => !process.env[k]);
    if (missing.length) {
        console.log(`  skipped the probe: ${missing.join(', ')} not set in this shell`);
        console.log('  the entry is written; restart the profile once those variables are available');
        return 0;
    }
    const probe = await probeServer(def, def.command ?? 'npx', args.timeoutMs);
    if (probe.ok) {
        console.log(`  OK — ${probe.toolCount ?? 0} tool(s) listed`);
        console.log(`\nRestart the profile to pick it up, then: dsh-mcp-bridge validate --profile ${profile}`);
        return 0;
    }
    console.error(`  FAILED at ${probe.stage ?? 'unknown'}: ${probe.error ?? 'unknown error'}`);
    console.error('  the entry is still written so you can fix it in place:');
    console.error(`    ${patchFile}`);
    console.error(`  to try the server by hand: npx -y ${pkg} ${args.extraArgs.join(' ')}`.trimEnd());
    return 1;
}
/**
 * Split a patch file into its `- insert:` entries.
 *
 * The renderer emits one entry per block with no blank lines inside, so detecting the top-level
 * `- insert:` lines is enough. Anything before the first one (the header comment) is preserved.
 */
export function parsePatchBlocks(content) {
    const lines = content.split(/\r?\n/);
    const starts = lines.map((l, i) => (l.trim() === '- insert:' ? i : -1)).filter((i) => i >= 0);
    return starts.map((start, k) => {
        const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
        const text = lines.slice(start, end).join('\n');
        return {
            start,
            end,
            id: /^\s*-\s*id:\s*(\S+)/m.exec(text)?.[1],
            serverName: /^\s*serverName:\s*(\S+)/m.exec(text)?.[1],
            text,
        };
    });
}
/** Remove the entry matching a server name or id, leaving every other entry intact. */
function cmdRemove(args) {
    const name = args.positional[0];
    if (!name) {
        console.error('Usage: dsh-mcp-bridge remove <serverName> [--profile <name>] [--dry-run]');
        return 2;
    }
    const profiles = listProfiles();
    const profile = args.profile ?? profiles[0];
    if (!profile) {
        console.error(`No profiles found under ${join(dshHome(), 'profiles')}.`);
        return 1;
    }
    const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
    if (!existsSync(patchFile)) {
        console.error(`No patch file for profile ${profile}: ${patchFile}`);
        return 2;
    }
    const content = readFileSync(patchFile, 'utf8');
    const blocks = parsePatchBlocks(content);
    const matches = blocks.filter((b) => b.id === name || b.id === `custom-${name}` || b.serverName === name);
    if (!matches.length) {
        console.error(`No entry for "${name}" in ${patchFile}`);
        const present = blocks.map((b) => b.serverName ?? b.id).filter(Boolean);
        if (present.length)
            console.error(`Entries present: ${present.join(', ')}`);
        return 2;
    }
    if (matches.length > 1) {
        console.error(`"${name}" matches ${matches.length} entries; be more specific:`);
        for (const b of matches)
            console.error(`  id=${b.id ?? '?'} serverName=${b.serverName ?? '?'}`);
        return 2;
    }
    const target = matches[0];
    const label = target.serverName ?? target.id ?? name;
    if (args.dryRun) {
        console.log(`Would remove ${label} (${target.id ?? '?'}) from ${patchFile}`);
        console.log('--dry-run: nothing written');
        return 0;
    }
    const before = content.split(/\r?\n/).slice(0, blocks[0].start).join('\n').trimEnd();
    const kept = blocks.filter((b) => b !== target).map((b) => b.text.trimEnd());
    const next = [before, ...kept].filter(Boolean).join('\n\n') + '\n';
    writeFileSync(patchFile, next, 'utf8');
    console.log(`Removed ${label} (${target.id ?? '?'}) from ${patchFile}`);
    console.log(`Restart the profile for it to take effect.`);
    return 0;
}
async function cmdDoctor(args) {
    const { spawn } = await import('node:child_process');
    const probe = join(HERE, '..', 'scripts', 'probe-server.mjs');
    if (!existsSync(probe)) {
        console.error('probe-server.mjs is missing from this installation — reinstall the package.');
        return 2;
    }
    const catalog = loadCatalog();
    const wanted = args.servers.length ? new Set(args.servers) : null;
    const targets = wanted ? catalog.filter((d) => wanted.has(d.serverName) || wanted.has(d.id)) : catalog;
    if (!targets.length) {
        console.error(wanted ? `No catalog entry matches: ${[...wanted].join(', ')}` : 'The catalog is empty.');
        return 2;
    }
    const runProbe = (def, command) => new Promise((resolveProbe) => {
        const child = spawn(process.execPath, [probe, command, ...(def.args ?? []), '--json'], {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        let stdout = '';
        let settled = false;
        const settle = (value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolveProbe(value);
        };
        const timer = setTimeout(() => {
            child.kill();
            settle({ ok: false, stage: 'connect', error: `no answer within ${Math.round(args.timeoutMs / 1000)}s` });
        }, args.timeoutMs);
        child.stdout.on('data', (d) => { stdout += String(d); });
        child.on('error', (err) => settle({ ok: false, stage: 'spawn', error: err.message }));
        child.on('close', () => {
            const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
            try {
                settle(JSON.parse(line));
            }
            catch {
                settle({ ok: false, stage: 'probe', error: 'the probe produced no result' });
            }
        });
    });
    const outcomes = [];
    for (const def of targets) {
        const base = { serverName: def.serverName, title: def.title };
        const missing = (def.requiredEnv ?? []).filter((k) => !process.env[k]);
        if (missing.length) {
            outcomes.push({ ...base, state: 'skipped', detail: `needs ${missing.join(', ')}` });
            continue;
        }
        if (def.transport === 'streamable-http') {
            outcomes.push({ ...base, state: 'skipped', detail: 'remote endpoint — not probed here' });
            continue;
        }
        if (!def.command) {
            outcomes.push({ ...base, state: 'skipped', detail: 'no command in the catalog entry' });
            continue;
        }
        const result = await runProbe(def, def.command);
        if (result.ok) {
            outcomes.push({ ...base, state: 'ok', detail: `${result.toolCount ?? 0} tools`, toolCount: result.toolCount });
        }
        else if (def.verify?.status === 'needs-config') {
            // The catalog already knows this one is not ready to run (placeholder path, missing account).
            // Reporting it as a failure would send the user looking for a bug that is not there.
            outcomes.push({
                ...base,
                state: 'skipped',
                detail: `needs configuration first — ${result.error ?? 'did not start'}`,
                advice: `fill in its settings before diagnosing: ${[def.command, ...(def.args ?? [])].filter(Boolean).join(' ')}`,
            });
        }
        else {
            outcomes.push({
                ...base,
                state: 'failed',
                detail: `${describeProbeStage(result.stage)}: ${result.error ?? 'unknown error'}`,
                advice: adviceFor(def, result.stage, result.error),
            });
        }
    }
    if (args.json) {
        console.log(JSON.stringify(outcomes, null, 2));
    }
    else {
        console.log(`Diagnosing ${targets.length} curated server(s), ${Math.round(args.timeoutMs / 1000)}s each…\n`);
        for (const o of outcomes) {
            const icon = o.state === 'ok' ? '✅' : o.state === 'skipped' ? '⏸ ' : '❌';
            console.log(`  ${icon} ${o.serverName.padEnd(14)} ${o.detail}`);
            if (o.advice)
                console.log(`       → ${o.advice}`);
        }
        const ok = outcomes.filter((o) => o.state === 'ok').length;
        const skipped = outcomes.filter((o) => o.state === 'skipped').length;
        const failed = outcomes.filter((o) => o.state === 'failed').length;
        console.log(`\n${ok} ok, ${skipped} skipped, ${failed} failed`);
    }
    return outcomes.some((o) => o.state === 'failed') ? 1 : 0;
}
/** Which servers a profile's patch layer actually installs. */
function installedInProfile(profile) {
    const patchFile = join(dshHome(), 'profiles', profile, 'cordis.patch.yml');
    if (!existsSync(patchFile))
        return { serverNames: new Set(), ids: [] };
    const blocks = parsePatchBlocks(readFileSync(patchFile, 'utf8'));
    return {
        serverNames: new Set(blocks.map((b) => b.serverName).filter((n) => Boolean(n))),
        ids: blocks.map((b) => b.id ?? '').filter(Boolean),
    };
}
function cmdList(args) {
    const catalog = loadCatalog();
    const installed = args.profile ? installedInProfile(args.profile) : null;
    if (args.json) {
        console.log(JSON.stringify(installed ? { catalog, installed: [...installed.serverNames], ids: installed.ids } : catalog, null, 2));
        return 0;
    }
    console.log(`${catalog.length} curated MCP server(s)${installed ? ` — profile "${args.profile}"` : ''}:\n`);
    for (const d of catalog) {
        const env = d.requiredEnv?.length ? `  (needs ${d.requiredEnv.join(', ')})` : '';
        const mark = installed ? (installed.serverNames.has(d.serverName) ? '  [installed]' : '') : '';
        console.log(`  ${d.serverName.padEnd(14)} ${statusIcon(d)}${env}${mark}`);
        console.log(`      ${d.description}`);
    }
    if (installed && args.profile) {
        const custom = [...installed.serverNames].filter((n) => !catalog.some((d) => d.serverName === n));
        if (custom.length) {
            console.log(`\nAlso installed in "${args.profile}" (not in the catalog):`);
            for (const name of custom)
                console.log(`  ${name}`);
        }
        const count = catalog.filter((d) => installed.serverNames.has(d.serverName)).length;
        console.log(`\n${count} of ${catalog.length} catalog server(s) installed in "${args.profile}".`);
    }
    return 0;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === '--version') {
        const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
        console.log(pkg.version);
        return 0;
    }
    if (args.command === '' || args.command === '--help' || args.command === 'help') {
        console.log(HELP);
        return args.command === '' ? 2 : 0;
    }
    switch (args.command) {
        case 'list': return cmdList(args);
        case 'init': return await cmdInit(args);
        case 'validate': return await cmdValidate(args);
        case 'doctor': return await cmdDoctor(args);
        case 'add': return await cmdAdd(args);
        case 'remove': return cmdRemove(args);
        default:
            console.error(`Unknown command: ${args.command}\n`);
            console.log(HELP);
            return 2;
    }
}
// Only run when executed directly (allows unit-testing the exports).
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    process.exit(await main());
}
