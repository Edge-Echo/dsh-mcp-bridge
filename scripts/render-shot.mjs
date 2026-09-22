// Render a CLI output capture into a terminal-styled PNG, at exactly the height
// the content needs.
//
// The two-step is deliberate:
//   1. the repo's own scripts/render-screenshot.mjs turns the .txt into styled HTML
//   2. a measuring script is injected, `--dump-dom` reports the card's real height,
//      and the screenshot is taken at that height
//
// Guessing the height either crops the content or leaves a band of dead space at
// the bottom, and both look like a bug in the tool being documented.
//
//   node scripts/render-shot.mjs assets/screenshot-doctor.txt assets/screenshot-doctor.png "netassist doctor"
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error('no Edge/Chrome found; set BROWSER_PATH to a Chromium-based browser')
  process.exit(2)
}

const [input, output, title = 'terminal', widthArg = '1160'] = process.argv.slice(2)
if (!input || !output) {
  console.error('usage: node scripts/render-shot.mjs <in.txt> <out.png> [title] [width]')
  process.exit(2)
}
const width = Number(widthArg)
const inPath = resolve(input)
const outPath = resolve(output)
const htmlPath = outPath.replace(/\.png$/i, '.html')
if (!existsSync(inPath)) {
  console.error(`missing ${inPath}`)
  process.exit(2)
}

// Step 1: text -> styled HTML, using the repo's renderer so there is exactly one
// definition of what the terminal chrome looks like.
const here = dirname(fileURLToPath(import.meta.url))
const renderer = join(here, 'render-screenshot.mjs')
execFileSync(process.execPath, [renderer, inPath, htmlPath, title], { stdio: ['ignore', 'ignore', 'inherit'] })

// Step 2: measure the card height inside the browser.
const html = readFileSync(htmlPath, 'utf8')
const probe = `<script>document.title='H='+Math.ceil(document.querySelector('.window').getBoundingClientRect().height+56)</script>`
if (!html.includes('H=')) writeFileSync(htmlPath, html.replace('</body>', `${probe}</body>`), 'utf8')

const profile = mkdtempSync(join(tmpdir(), 'shot-render-'))
const url = pathToFileURL(htmlPath).href
let height = 0
try {
  const dom = execFileSync(
    browser,
    ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=2000', '--dump-dom', url],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 },
  )
  height = Number(/H=(\d+)/.exec(dom)?.[1] ?? 0)
} catch {
  height = 0
}
if (!Number.isFinite(height) || height < 200) {
  console.error('could not measure content height; falling back to 800px')
  height = 800
}

// Step 3: screenshot at that exact height.
try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--force-device-scale-factor=1',
      '--virtual-time-budget=3000',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--screenshot=${outPath}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
} catch (err) {
  if (!existsSync(outPath)) {
    console.error(`render failed: ${err.message}`)
    process.exit(1)
  }
} finally {
  rmSync(profile, { recursive: true, force: true })
}

if (!existsSync(outPath)) {
  console.error('browser produced no screenshot')
  process.exit(1)
}
const bytes = statSync(outPath).size
console.log(`rendered ${input} -> ${output} (${width}x${height}, ${bytes} bytes)`)
if (bytes < 10_000) console.error('warning: suspiciously small PNG, check for a blank render')
