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
      <label class="check" title="Open XPP's new windows as separate browser windows (allow pop-ups for this site). Any window can also be popped out with ⧉ in its title bar.">
        <input type="checkbox" id="separate"> New windows in separate browser windows
      </label>
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
  const q = new URLSearchParams(location.search)
  q.set('ode', name) // keep other parameters (e.g. engine=asyncify for testing)
  history.replaceState(null, '', '?' + q.toString())
  session = new XppSession(desktop, {
    onOutput: output,
    onNotice: (msg) => {
      $('status').textContent = msg
      setTimeout(() => ($('status').textContent = name), 6000)
    },
    onExit: (status) => {
      $('status').textContent = `${name} — XPP exited (${status})`
    },
  })
  session.popOutNew = $<HTMLInputElement>('separate').checked
  ;(window as unknown as { xpp: XppSession }).xpp = session // for tests and debugging
  await session.start(name, text)
}

// remember the separate-windows choice (per browser)
const separate = $<HTMLInputElement>('separate')
try {
  separate.checked = localStorage.getItem('xpp-separate') === '1'
} catch {
  /* storage unavailable */
}
separate.addEventListener('change', () => {
  if (session) session.popOutNew = separate.checked
  try {
    localStorage.setItem('xpp-separate', separate.checked ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
})

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
