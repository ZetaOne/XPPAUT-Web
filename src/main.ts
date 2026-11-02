import './style.css'
import { XppSession } from './xpp'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header class="bar">
    <strong class="brand">XPPAUT-Web</strong>
    <div class="start" id="start">
      <label>Example
        <select id="example"><option>loading…</option></select>
      </label>
      <button id="run">Run</button>
      <span class="sep">or</span>
      <label class="file">Open .ode file…<input type="file" id="upload" accept=".ode,text/plain" hidden></label>
    </div>
    <div class="session" id="session" hidden>
      <span id="status"></span>
      <details class="files" id="files">
        <summary>Files</summary>
        <ul id="filelist"></ul>
      </details>
      <button id="restart">Restart</button>
    </div>
  </header>
  <main class="desktop" id="desktop">
    <p class="hint" id="hint">Pick an example or open your own <code>.ode</code> file to start XPP.</p>
  </main>
  <details class="log" id="logbox">
    <summary>XPP output</summary>
    <pre id="log"></pre>
  </details>
`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const example = $<HTMLSelectElement>('example')
const log = $<HTMLPreElement>('log')
const desktop = $<HTMLElement>('desktop')

let session: XppSession | null = null

function output(line: string) {
  log.textContent += line + '\n'
  log.scrollTop = log.scrollHeight
}

async function launch(name: string, text: string) {
  $('start').hidden = true
  $('session').hidden = false
  $('hint').remove()
  $('status').textContent = name
  history.replaceState(null, '', '?ode=' + encodeURIComponent(name))
  session = new XppSession(desktop, {
    onOutput: output,
    onExit: (status) => {
      $('status').textContent = `${name} — XPP exited (${status})`
    },
  })
  await session.start(name, text)
}

async function loadExample(name: string) {
  const res = await fetch('odes/' + encodeURIComponent(name))
  if (!res.ok) throw new Error(`cannot load ${name}`)
  await launch(name, await res.text())
}

// examples
fetch('odes/index.json')
  .then((r) => r.json())
  .then((names: string[]) => {
    example.innerHTML = names.map((n) => `<option>${n}</option>`).join('')
    example.value = names.includes('lecar.ode') ? 'lecar.ode' : names[0]
    const q = new URLSearchParams(location.search).get('ode')
    if (q && names.includes(q)) loadExample(q)
  })

$('run').addEventListener('click', () => loadExample(example.value))
$<HTMLInputElement>('upload').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await launch(f.name, await f.text())
})
$('restart').addEventListener('click', () => location.reload())

// files XPP wrote: list them when the menu opens, download on click
$('files').addEventListener('toggle', () => {
  const list = $('filelist')
  const names = session?.listFiles() ?? []
  list.innerHTML = names.length ? '' : '<li class="empty">No files yet</li>'
  for (const n of names) {
    const li = document.createElement('li')
    const a = document.createElement('a')
    a.textContent = n
    a.href = '#'
    a.addEventListener('click', (ev) => {
      ev.preventDefault()
      const data = session!.readFile(n)
      const url = URL.createObjectURL(new Blob([data as BlobPart]))
      const link = document.createElement('a')
      link.href = url
      link.download = n
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    })
    li.append(a)
    list.append(li)
  }
})
