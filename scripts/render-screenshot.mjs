// Render a CLI output file into a terminal-styled HTML page, ready for a
// headless-browser screenshot. Deliberately dependency-free: it understands
// only the small Markdown subset our own reports emit (#/##/### headings,
// tables, bold, inline code, lists, blockquotes, rules).
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output, titleArg] = process.argv
if (!input || !output) {
  console.error('usage: node render-screenshot.mjs <input.txt> <output.html> [title]')
  process.exit(2)
}

const title = titleArg ?? 'dsh-driftwatch'

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

const lines = readFileSync(input, 'utf8').split('\n')
const html = []
let inTable = false
let inList = false

const closeBlocks = () => {
  if (inTable) { html.push('</tbody></table>'); inTable = false }
  if (inList) { html.push('</ul>'); inList = false }
}

for (const raw of lines) {
  const line = raw.replace(/\r$/, '')
  if (/^\|\s*[-: |]+\|?\s*$/.test(line)) continue // table separator
  if (/^\|/.test(line)) {
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (!inTable) {
      closeBlocks()
      html.push('<table><tbody>')
      inTable = true
      html.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`)
    } else {
      html.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    }
    continue
  }
  if (/^###\s/.test(line)) { closeBlocks(); html.push(`<h3>${inline(line.slice(4))}</h3>`); continue }
  if (/^##\s/.test(line)) { closeBlocks(); html.push(`<h2>${inline(line.slice(3))}</h2>`); continue }
  if (/^#\s/.test(line)) { closeBlocks(); html.push(`<h1>${inline(line.slice(2))}</h1>`); continue }
  if (/^-\s/.test(line)) {
    if (!inList) { closeBlocks(); html.push('<ul>'); inList = true }
    html.push(`<li>${inline(line.slice(2))}</li>`)
    continue
  }
  if (/^>\s?/.test(line)) { closeBlocks(); html.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); continue }
  if (/^---+$/.test(line)) { closeBlocks(); html.push('<hr>'); continue }
  if (line.trim() === '') { closeBlocks(); continue }
  closeBlocks()
  html.push(`<p>${inline(line)}</p>`)
}
closeBlocks()

const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px; background: #0b0f19;
    font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace;
    color: #e6edf3;
  }
  .window {
    max-width: 1080px; margin: 0 auto; background: #0d1117;
    border: 1px solid #232b3a; border-radius: 12px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,.55);
  }
  .bar {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; background: #161b26; border-bottom: 1px solid #232b3a;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot.r { background: #ff5f57; } .dot.y { background: #febc2e; } .dot.g { background: #28c840; }
  .bar .title { margin-left: 8px; color: #8b949e; font-size: 13px; }
  .body { padding: 22px 26px 30px; font-size: 13.5px; line-height: 1.55; }
  h1 { font-size: 19px; margin: 0 0 14px; color: #f0f6fc; }
  h2 { font-size: 15px; margin: 22px 0 8px; color: #79c0ff; }
  h3 { font-size: 14px; margin: 18px 0 6px; color: #79c0ff; }
  p { margin: 6px 0; }
  code { background: #1f2633; padding: 1px 6px; border-radius: 5px; color: #ffd580; font-size: 12.5px; }
  strong { color: #ffffff; }
  table { border-collapse: collapse; margin: 10px 0 14px; font-size: 12.5px; }
  th, td { border: 1px solid #232b3a; padding: 5px 12px; text-align: left; }
  th { background: #161b26; color: #8b949e; font-weight: 600; }
  td:first-child { color: #c9d1d9; }
  ul { margin: 8px 0 12px; padding-left: 22px; }
  li { margin: 3px 0; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #3b4b63; color: #8b949e; background: #11161f; }
  hr { border: 0; border-top: 1px solid #232b3a; margin: 18px 0; }
  a { color: #58a6ff; text-decoration: none; }
</style></head>
<body>
  <div class="window">
    <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">${escapeHtml(title)}</span></div>
    <div class="body">
${html.join('\n')}
    </div>
  </div>
</body></html>
`

writeFileSync(output, page, 'utf8')
console.log(`rendered ${input} -> ${output} (${page.length} bytes)`)
