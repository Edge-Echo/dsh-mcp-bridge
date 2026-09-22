// Rasterise banner.svg -> banner.png with the system's headless browser.
//
// The SVG is the source of truth; this exists so the PNG is reproducible instead
// of being a one-off export nobody can regenerate. Uses Edge or Chrome already
// installed on the machine — no npm dependency, no download.
//
//   node scripts/render-banner.mjs                       # banner.svg -> banner.png
//   node scripts/render-banner.mjs in.svg out.png 1600 800
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error('no Edge/Chrome found; set BROWSER_PATH to a Chromium-based browser')
  process.exit(2)
}

const [input = 'banner.svg', output = 'banner.png', w = '1280', h = '640'] = process.argv.slice(2)
const inPath = resolve(input)
const outPath = resolve(output)
if (!existsSync(inPath)) {
  console.error(`missing ${inPath}`)
  process.exit(2)
}

// A throwaway profile keeps the render from touching (or being blocked by) the
// user's real browser profile.
const profile = mkdtempSync(join(tmpdir(), 'banner-render-'))
try {
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=1',
      // Without a virtual time budget the screenshot can be taken before first
      // paint, which silently yields a blank white image.
      '--virtual-time-budget=3000',
      `--user-data-dir=${profile}`,
      `--window-size=${w},${h}`,
      `--screenshot=${outPath}`,
      pathToFileURL(inPath).href,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
} catch (err) {
  // Chromium exits non-zero on some platforms even after a successful shot, so
  // decide on the artifact rather than the exit code.
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
console.log(`rendered ${input} -> ${output} (${w}x${h}, ${statSync(outPath).size} bytes)`)
