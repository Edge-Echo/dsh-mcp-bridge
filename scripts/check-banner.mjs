// Banner smoke check.
//
// Exists because a banner failed silently: a bare `&` in the SVG (from the
// subtitle "Network & proxy diagnostics") made the document invalid XML, and a
// browser renders that as a blank white page with no error anywhere. Nothing in
// the build noticed; the image was simply wrong.
//
// So this checks the two failure modes that actually happened:
//   1. the SVG is not well-formed (bare ampersand, unbalanced groups)
//   2. the rendered PNG looks like an empty page (tiny file for a 1280x640 image)
import { readFileSync, existsSync, statSync } from 'node:fs'

const svgPath = process.argv[2] ?? 'banner.svg'
const pngPath = process.argv[3] ?? 'banner.png'
let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failed++
}

check('banner.svg exists', existsSync(svgPath))

if (existsSync(svgPath)) {
  const svg = readFileSync(svgPath, 'utf8')
  // A bare & is the difference between a document and a blank page.
  const bareAmp = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(svg)
  check('no unescaped ampersand', !bareAmp)
  const opens = (svg.match(/<g[ >]/g) ?? []).length
  const closes = (svg.match(/<\/g>/g) ?? []).length
  check('groups balance', opens === closes, `${opens} open / ${closes} close`)
  check('viewBox declares 1280x640', /viewBox="0 0 1280 640"/.test(svg))
  const label = /aria-label="([^"]*)"/.exec(svg)?.[1]
  check('aria-label present', Boolean(label), label ?? '(none)')
  const chips = [...svg.matchAll(/text-anchor="middle" fill="#[0-9a-f]{6}">([^<]+)<\/text>/g)].map((m) => m[1])
  check('capability chips present', chips.length > 0, chips.join(' | '))
}

if (existsSync(pngPath)) {
  const bytes = statSync(pngPath).size
  // A blank page compresses to a few KB; a real gradient banner is far larger.
  check('rendered PNG is not a blank page', bytes > 50_000, `${bytes} bytes`)
} else {
  check('banner.png exists', false, 'run: node scripts/render-banner.mjs')
}

console.log(failed === 0 ? '\nbanner ok' : `\n${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
