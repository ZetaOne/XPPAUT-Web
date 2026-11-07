#!/usr/bin/env node
// README.md as a PDF, for people who want something to print or attach:
// GitHub renders the Markdown (same look as the repo page), Chrome prints it.
//
//   node scripts/readme-pdf.mjs [out.pdf]     (default: dist/XPPAUT-Web-README.pdf)
//
// Needs the gh CLI (logged in, or GH_TOKEN in CI) and Chrome (CHROME=...).
// The site build runs it, so the PDF on the website follows every update.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] || join(root, 'dist', 'XPPAUT-Web-README.pdf'))
const REPO = 'ZetaOne/XPPAUT-Web'
const SITE = 'https://zetaone.github.io/XPPAUT-Web/'

const md = readFileSync(join(root, 'README.md'), 'utf8')
const tmp = mkdtempSync(join(tmpdir(), 'readme-pdf-'))
writeFileSync(join(tmp, 'body.json'), JSON.stringify({ text: md, mode: 'gfm', context: REPO }))
let body = execFileSync('gh', ['api', '-X', 'POST', '/markdown', '--input', join(tmp, 'body.json')], { encoding: 'utf8' })

// pictures from the repo folder; other relative links to the repo on GitHub
const repoFile = (p) => pathToFileURL(join(root, p)).href
body = body
  .replace(/(<img[^>]*\ssrc=")(?!https?:|data:)([^"]+)"/g, (_, a, p) => `${a}${repoFile(p)}"`)
  .replace(/(<a[^>]*\shref=")(?!https?:|#|mailto:)([^"]+)"/g, (_, a, p) => `${a}https://github.com/${REPO}/blob/master/${p}"`)
  // GitHub's anchors are "user-content-x"; the links say "#x"
  .replace(/\sid="user-content-([^"]+)"/g, ' id="$1"')

const date = new Date().toISOString().slice(0, 10)
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>XPPAUT-Web</title>
<style>
@page { size: Letter; margin: 16mm 15mm 18mm; }
body { font: 10.5pt/1.5 -apple-system, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: #1f2328; }
.top { display: flex; justify-content: space-between; color: #59636e; font-size: 9pt; border-bottom: 1px solid #d1d9e0; padding-bottom: 4px; margin-bottom: 14px; }
.top a { color: #0969da; }
h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.5em; break-after: avoid; }
h1 { font-size: 22pt; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.2em; }
h2 { font-size: 15pt; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.2em; }
h3 { font-size: 12pt; }
a { color: #0969da; text-decoration: none; }
code { font: 9pt ui-monospace, "SF Mono", Menlo, Consolas, monospace; background: #eff2f5; padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: #f6f8fa; padding: 10px 12px; border-radius: 6px; overflow: hidden; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 0.8em 0; padding: 0.2em 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
table { border-collapse: collapse; margin: 0.8em 0; break-inside: avoid; }
th, td { border: 1px solid #d1d9e0; padding: 4px 10px; }
img { max-width: 100%; }
p[align=center], div[align=center] { text-align: center; }
li { margin: 0.15em 0; }
.markdown-alert { padding: 0.3em 1em; border-left: 4px solid #0969da; margin: 0.8em 0; }
.anchor, .octicon { display: none; }
</style></head><body>
<div class="top"><span>XPPAUT-Web: <a href="${SITE}">${SITE.replace('https://', '')}</a></span><span>github.com/${REPO} · ${date}</span></div>
${body}
</body></html>`
writeFileSync(join(tmp, 'readme.html'), html)

const chrome = process.env.CHROME || 'google-chrome'
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  '--allow-file-access-from-files', '--virtual-time-budget=8000',
  `--user-data-dir=${join(tmp, 'profile')}`,
  `--print-to-pdf=${out}`, pathToFileURL(join(tmp, 'readme.html')).href,
], { stdio: ['ignore', 'ignore', 'pipe'] })
rmSync(tmp, { recursive: true, force: true })
console.log(`${out} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`)
