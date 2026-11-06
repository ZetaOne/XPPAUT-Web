#!/usr/bin/env node
// Two downloads for using XPPAUT-Web on a computer without the internet,
// made from the built site (run `npm run build` first):
//
//   offline/XPPAUT-Web.html         one file: open it in the browser and XPP
//                                   runs (WebAssembly, examples and help are
//                                   inside it, gzip + base64)
//   offline/XPPAUT-Web-offline.zip  the site as files plus a small local web
//                                   server to start it (Python, or PowerShell
//                                   on Windows)
//
// A page opened from a file cannot fetch other files or load module scripts,
// so the single file carries everything and a small script in it answers the
// page's fetch() calls for them (src/xpp.ts asks `xppOffline` for the XPP
// loader and the help).
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const out = join(root, 'offline')
rmSync(out, { recursive: true, force: true })
mkdirSync(out)

const walk = (dir, sub = '') =>
  readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(sub, e.name)) : [join(sub, e.name).replaceAll('\\', '/')],
  )

// ---- 1. single HTML file ------------------------------------------------------
let html = readFileSync(join(dist, 'index.html'), 'utf8')
const files = {}
for (const f of walk(dist)) {
  if (/^(wasm|odes|help)\//.test(f)) files[f] = gzipSync(readFileSync(join(dist, f)), { level: 9 }).toString('base64')
}

// the page's own script and style, inline (an inline module script runs from a file)
const inline = (s) => s.replace(/<\/(script)/gi, '<\\/$1')
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, f) =>
  `<script type="module">${inline(readFileSync(join(dist, f), 'utf8'))}</script>`,
)
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, f) =>
  `<style>${readFileSync(join(dist, f), 'utf8')}</style>`,
)
// icon inline; no install manifest (a file cannot be installed as an app)
const icon = readFileSync(join(dist, 'favicon-32.png')).toString('base64')
html = html
  .replace(/\s*<link rel="icon"[^>]*>/g, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace('<title>', `<link rel="icon" type="image/png" href="data:image/png;base64,${icon}" />\n    <title>`)
if (!html.includes('<script type="module">') || !html.includes('<style>')) throw new Error('index.html: script or style not found')

// answers fetch() for the files inside the page; loader and help for src/xpp.ts
const shim = `(() => {
  const F = JSON.parse(document.getElementById('xpp-files').textContent)
  const base = new URL('.', document.baseURI)
  const got = new Map()
  const bytes = (k) => {
    if (!got.has(k)) {
      const z = Uint8Array.from(atob(F[k]), (c) => c.charCodeAt(0))
      got.set(k, new Response(new Blob([z]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    }
    return got.get(k).then((b) => new Uint8Array(b))
  }
  const text = (k) => bytes(k).then((b) => new TextDecoder().decode(b))
  const key = (input) => {
    try {
      const u = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, document.baseURI)
      if (u.protocol !== base.protocol || u.host !== base.host || !u.pathname.startsWith(base.pathname)) return null
      const k = decodeURIComponent(u.pathname.slice(base.pathname.length))
      return k in F ? k : null
    } catch {
      return null
    }
  }
  const type = (k) =>
    k.endsWith('.wasm') ? 'application/wasm' : k.endsWith('.mjs') ? 'text/javascript' : k.endsWith('.json') ? 'application/json'
    : k.endsWith('.html') ? 'text/html' : 'text/plain'
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const k = key(input)
    if (k === null) return realFetch(input, init)
    return new Response(await bytes(k), { headers: { 'Content-Type': type(k) } })
  }
  const blobUrl = async (k) => URL.createObjectURL(new Blob([await bytes(k)], { type: type(k) }))
  // help: pages are written into one browser window; links between them stay inside
  const show = async (w, page, hash) => {
    const html = await text('help/' + page)
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.document.addEventListener('click', async (e) => {
      const a = e.target.closest && e.target.closest('a[href]')
      if (!a) return
      const [p, h] = a.getAttribute('href').split('#')
      if (!p) return // anchor on the same page
      const k = 'help/' + p.replace(/^\\.\\//, '')
      if (!(k in F)) return // outside link
      e.preventDefault()
      if (k.endsWith('.html')) show(w, k.slice(5), h)
      else window.open(await blobUrl(k), '_blank')
    })
    if (hash) (w.document.getElementById(hash) || w.document.getElementsByName(hash)[0])?.scrollIntoView()
    else w.scrollTo(0, 0)
  }
  window.xppOffline = {
    moduleUrl: (url) => {
      const k = key(url)
      return k === null ? Promise.resolve(url) : blobUrl(k)
    },
    openHelp: (page) => {
      const w = window.open('', 'xpp-help')
      if (w) show(w, page)
    },
  }
})()`

html = html.replace(
  '<script>',
  `<script type="application/json" id="xpp-files">${JSON.stringify(files)}</script>\n    <script>${shim}</script>\n    <script>`,
)
writeFileSync(join(out, 'XPPAUT-Web.html'), html)

// ---- 2. zip: the site + a local web server -------------------------------------
const stage = join(out, 'stage')
const top = join(stage, 'XPPAUT-Web')
cpSync(dist, join(top, 'site'), { recursive: true, filter: (s) => !s.includes(`${dist}/videos`) })

writeFileSync(
  join(top, 'serve.py'),
  `#!/usr/bin/env python3
"""Serve XPPAUT-Web from this folder on this computer only (127.0.0.1) and open
it in the browser. Stop it by closing this window or pressing Ctrl+C."""
import http.server, os, socket, threading, webbrowser

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "site"))
Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".ode": "text/plain", ".tab": "text/plain", ".ani": "text/plain", ".dat": "text/plain",
})
Handler.log_message = lambda *args: None  # quiet

for port in range(8765, 8800):
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        break
    except OSError:
        continue
else:
    raise SystemExit("No free port between 8765 and 8799")

url = "http://localhost:%d/" % port
print("XPPAUT-Web is running at " + url)
print("Keep this window open while you use it; close it (or press Ctrl+C) to stop.")
threading.Timer(0.8, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
`,
)

const unix = (opener) => `#!/bin/sh
# Start XPPAUT-Web on this computer (needs Python 3), then open it in the browser.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then exec python3 -u serve.py; fi
echo "Python 3 is needed (${opener}). Or use XPPAUT-Web.html: it needs nothing."
read -r _
`
writeFileSync(join(top, 'Start XPPAUT (Mac).command'), unix('macOS asks to install it the first time'))
writeFileSync(join(top, 'start-linux.sh'), unix('e.g. sudo apt install python3'))
for (const f of ['Start XPPAUT (Mac).command', 'start-linux.sh', 'serve.py']) chmodSync(join(top, f), 0o755)

// Windows: Python if installed, else a small PowerShell server (built into Windows)
writeFileSync(
  join(top, 'Start XPPAUT (Windows).bat'),
  `@echo off\r
rem Start XPPAUT-Web on this computer, then open it in the browser.\r
cd /d "%~dp0"\r
where py >nul 2>nul && (py -3 serve.py & goto :eof)\r
where python >nul 2>nul && (python serve.py & goto :eof)\r
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1\r
`,
)
writeFileSync(
  join(top, 'serve.ps1'),
  `# Serve XPPAUT-Web from the site folder on this computer only, then open it.\r
# Used by "Start XPPAUT (Windows).bat" when Python is not installed.\r
$site = Join-Path $PSScriptRoot 'site'\r
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.mjs'='text/javascript';\r
  '.css'='text/css'; '.wasm'='application/wasm'; '.json'='application/json';\r
  '.webmanifest'='application/manifest+json'; '.png'='image/png'; '.svg'='image/svg+xml' }\r
$listener = $null\r
foreach ($port in 8765..8799) {\r
  try { $l = New-Object System.Net.HttpListener; $l.Prefixes.Add("http://localhost:$port/"); $l.Start(); $listener = $l; break } catch { }\r
}\r
if (-not $listener) { Write-Host 'No free port between 8765 and 8799'; Read-Host; exit 1 }\r
$url = "http://localhost:$port/"\r
Write-Host "XPPAUT-Web is running at $url"\r
Write-Host 'Keep this window open while you use it; close it to stop.'\r
Start-Process $url\r
while ($listener.IsListening) {\r
  $ctx = $listener.GetContext()\r
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')\r
  if ($path -eq '') { $path = 'index.html' }\r
  $file = [IO.Path]::GetFullPath((Join-Path $site $path))\r
  $res = $ctx.Response\r
  if ($file.StartsWith([IO.Path]::GetFullPath($site)) -and (Test-Path $file -PathType Leaf)) {\r
    $ext = [IO.Path]::GetExtension($file).ToLower()\r
    $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'text/plain' }\r
    $bytes = [IO.File]::ReadAllBytes($file)\r
    $res.ContentLength64 = $bytes.Length\r
    $res.OutputStream.Write($bytes, 0, $bytes.Length)\r
  } else { $res.StatusCode = 404 }\r
  $res.Close()\r
}\r
`,
)
writeFileSync(
  join(top, 'README.txt'),
  `XPPAUT-Web for this computer, no internet needed
================================================

Start it:
  Mac:      double-click "Start XPPAUT (Mac).command"
            (the first time: right-click it, choose Open, then Open; macOS
            may also offer to install Python's command line tools - accept)
  Windows:  double-click "Start XPPAUT (Windows).bat"
  Linux:    run ./start-linux.sh

It opens XPPAUT-Web in your browser at http://localhost:8765/ (served from the
"site" folder, only to this computer). Keep the small window that opens; close
it to stop.

Simpler still: XPPAUT-Web.html (a separate download) is the same program in a
single file that you just open in the browser.

Online version and source: https://zetaone.github.io/XPPAUT-Web/
                           https://github.com/ZetaOne/XPPAUT-Web
`,
)
execFileSync('zip', ['-qrX', join(out, 'XPPAUT-Web-offline.zip'), 'XPPAUT-Web'], { cwd: stage })
rmSync(stage, { recursive: true })

const mb = (f) => (readFileSync(join(out, f)).length / 1048576).toFixed(1) + ' MB'
console.log(`offline/XPPAUT-Web.html ${mb('XPPAUT-Web.html')}, offline/XPPAUT-Web-offline.zip ${mb('XPPAUT-Web-offline.zip')}`)
