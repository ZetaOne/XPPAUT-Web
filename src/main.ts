import './style.css'
import { XppSession } from './xpp'
import { Terminal, type TerminalMode } from './terminal'
import { download, makeZip } from './zip'

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
      <label class="file" title="Pick an .ode file, plus any files it uses (.ani, .tab, .dat, .set)">Open .ode file…<input type="file" id="upload" multiple hidden></label>
    </div>
    <div class="session" id="session" hidden>
      <span id="status"></span>
      <button id="edit" title="Edit the .ode file, then download it or restart XPP with it">Edit .ode</button>
      <details class="files" id="files">
        <summary>Files <span class="badge" id="fcount"></span></summary>
        <div class="files-panel">
          <div class="files-head">
            <span>XPP's working folder</span>
            <label class="file small" title="Add data, table, .ani or .set files for XPP to open">Add files…<input type="file" id="addfiles" multiple hidden></label>
            <button class="small" id="zipall">Download all (.zip)</button>
          </div>
          <table id="filelist"></table>
          <p class="files-note">Plots: XPP's <b>Graphic stuff → Postscript</b> (or SVG) writes a file here; ⤓ on any window's title bar saves it as PNG.</p>
        </div>
      </details>
      <label title="XPP's terminal output (messages, errors, printed values)">Output
        <select id="termmode">
          <option value="hidden">Hidden</option>
          <option value="side">Side panel</option>
          <option value="window">Separate window</option>
        </select>
      </label>
      <label class="check" title="Open XPP's new windows as separate browser windows (allow pop-ups for this site). Any window can also be popped out with ⧉ in its title bar.">
        <input type="checkbox" id="separate"> Separate windows
      </label>
      <button id="restart">Restart</button>
    </div>
  </header>
  <div class="layout">
    <main class="desktop" id="desktop">
      <p class="hint" id="hint">Pick an example or open your own <code>.ode</code> file to start XPP.</p>
    </main>
    <aside class="term" id="term" hidden>
      <div class="term-head">
        <span>XPP output</span>
        <button class="small" id="termsave" title="Download the output as a text file">Save</button>
        <button class="small" id="termclear">Clear</button>
        <button class="xwin-btn" id="termclose" title="Hide">×</button>
      </div>
      <pre id="termpre"></pre>
    </aside>
  </div>
  <dialog id="editor">
    <form method="dialog" class="editor">
      <div class="editor-head"><b id="edname"></b><span class="muted">Changes take effect when XPP restarts.</span></div>
      <textarea id="edtext" spellcheck="false"></textarea>
      <div class="editor-foot">
        <button type="button" id="eddownload">Download</button>
        <button type="button" id="edrestart">Restart XPP with this file</button>
        <button value="cancel">Close</button>
      </div>
    </form>
  </dialog>
`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const example = $<HTMLSelectElement>('example')
const desktop = $<HTMLElement>('desktop')
const termMode = $<HTMLSelectElement>('termmode')
const separate = $<HTMLInputElement>('separate')

let session: XppSession | null = null
let odeName = ''

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* storage unavailable */
    }
  },
}

// ---- terminal output ------------------------------------------------------
const terminal = new Terminal($('term'), $<HTMLPreElement>('termpre'))
terminal.onModeChange = (m) => {
  termMode.value = m
  store.set('xpp-terminal', m)
}
const savedMode = (store.get('xpp-terminal') as TerminalMode) || 'hidden'
termMode.value = savedMode
// a separate window can only be opened from a click; start in the side panel
terminal.setMode(savedMode === 'window' ? 'side' : savedMode)
termMode.addEventListener('change', () => {
  const used = terminal.setMode(termMode.value as TerminalMode)
  if (used !== termMode.value) notice('Pop-up blocked: output shown in the side panel (allow pop-ups for this site)')
  termMode.value = used
  store.set('xpp-terminal', used)
})
$('termclose').addEventListener('click', () => {
  termMode.value = terminal.setMode('hidden')
  store.set('xpp-terminal', 'hidden')
})
$('termclear').addEventListener('click', () => terminal.clear())
$('termsave').addEventListener('click', () =>
  download((odeName || 'xpp') + '-output.txt', new Blob([terminal.text()], { type: 'text/plain' })),
)

function notice(msg: string) {
  $('status').textContent = msg
  $('status').title = msg
  setTimeout(() => ($('status').textContent = odeName), 7000)
}

// ---- starting XPP -----------------------------------------------------------
async function launch(name: string, text: string, extras: Array<{ name: string; data: Uint8Array }> = []) {
  odeName = name
  $('start').hidden = true
  $('session').hidden = false
  $('hint')?.remove()
  $('status').textContent = name
  const q = new URLSearchParams(location.search)
  q.set('ode', name) // keep other parameters (e.g. engine=asyncify for testing)
  history.replaceState(null, '', '?' + q.toString())
  // the user's click that started XPP can open the output window
  if (store.get('xpp-terminal') === 'window') termMode.value = terminal.setMode('window')
  session = new XppSession(desktop, {
    onOutput: (line) => terminal.write(line),
    onNotice: notice,
    onExit: (status) => {
      $('status').textContent = `${name} — XPP exited (${status})`
    },
  })
  session.popOutNew = separate.checked
  ;(window as unknown as { xpp: XppSession }).xpp = session // for tests and debugging
  setInterval(updateFileCount, 2000)
  await session.start(name, text, extras)
}

async function loadExample(name: string) {
  const res = await fetch('odes/' + encodeURIComponent(name))
  if (!res.ok) throw new Error(`cannot load ${name}`)
  const text = await res.text()
  // bring along the data files the example uses: any bundled .ani/.tab/.dat
  // named in it, and the .ani of the same name (pend.ode + pend.ani)
  const wanted = new Set([name.replace(/\.ode$/, '.ani')])
  for (const m of text.matchAll(/[\w.+-]+\.(?:ani|tab|dat)\b/gi)) wanted.add(m[0])
  const extras: Array<{ name: string; data: Uint8Array }> = []
  for (const f of wanted) {
    if (!dataFiles.has(f)) continue
    const r = await fetch('odes/' + encodeURIComponent(f))
    if (r.ok) extras.push({ name: f, data: new Uint8Array(await r.arrayBuffer()) })
  }
  await launch(name, text, extras)
}

let dataFiles = new Set<string>()
fetch('odes/index.json')
  .then((r) => r.json())
  .then((names: string[]) => {
    dataFiles = new Set(names.filter((n) => !n.endsWith('.ode')))
    const odes = names.filter((n) => n.endsWith('.ode'))
    example.innerHTML = odes.map((n) => `<option>${n}</option>`).join('')
    example.value = odes.includes('lecar.ode') ? 'lecar.ode' : odes[0]
    const q = new URLSearchParams(location.search)
    const edited = restoreEdited(q.get('ode'))
    if (edited) launch(edited.name, edited.text, edited.extras)
    else if (q.get('ode') && odes.includes(q.get('ode')!)) loadExample(q.get('ode')!)
  })

$('run').addEventListener('click', () => loadExample(example.value))
$<HTMLInputElement>('upload').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])]
  const ode = files.find((f) => /\.ode$/i.test(f.name)) ?? files[0]
  if (!ode) return
  const extras = await Promise.all(
    files.filter((f) => f !== ode).map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
  )
  await launch(ode.name, await ode.text(), extras)
})
$('restart').addEventListener('click', () => location.reload())

separate.checked = store.get('xpp-separate') === '1'
separate.addEventListener('change', () => {
  if (session) session.popOutNew = separate.checked
  store.set('xpp-separate', separate.checked ? '1' : '0')
})

// ---- files ------------------------------------------------------------------
function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
}

function updateFileCount() {
  const n = session?.listFiles().length ?? 0
  $('fcount').textContent = n ? String(n) : ''
}

function renderFiles() {
  const table = $<HTMLTableElement>('filelist')
  const files = session?.listFiles() ?? []
  table.innerHTML = files.length ? '' : '<tr><td class="muted">No files yet</td></tr>'
  for (const f of files) {
    const tr = document.createElement('tr')
    const name = document.createElement('td')
    const a = document.createElement('a')
    a.href = '#'
    a.textContent = f.name
    a.title = 'Download'
    a.addEventListener('click', (ev) => {
      ev.preventDefault()
      download(f.name, session!.readFile(f.name))
    })
    name.append(a)
    const size = document.createElement('td')
    size.className = 'num'
    size.textContent = formatSize(f.size)
    const time = document.createElement('td')
    time.className = 'muted'
    time.textContent = new Date(f.mtime).toLocaleTimeString()
    tr.append(name, size, time)
    table.append(tr)
  }
}

$('files').addEventListener('toggle', () => {
  if (($('files') as HTMLDetailsElement).open) renderFiles()
})
$('zipall').addEventListener('click', () => {
  if (!session) return
  const files = session.listFiles().map((f) => ({ name: f.name, data: session!.readFile(f.name) }))
  if (files.length) download(odeName.replace(/\.ode$/, '') + '-files.zip', makeZip(files))
})
$<HTMLInputElement>('addfiles').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  for (const f of input.files ?? []) session?.writeFile(f.name, new Uint8Array(await f.arrayBuffer()))
  input.value = ''
  renderFiles()
  updateFileCount()
})

// ---- .ode editor --------------------------------------------------------------
const editor = $<HTMLDialogElement>('editor')
$('edit').addEventListener('click', () => {
  if (!session) return
  $('edname').textContent = odeName
  $<HTMLTextAreaElement>('edtext').value = new TextDecoder().decode(session.readFile(odeName))
  editor.showModal()
})
$('eddownload').addEventListener('click', () =>
  download(odeName, new Blob([$<HTMLTextAreaElement>('edtext').value], { type: 'text/plain' })),
)
$('edrestart').addEventListener('click', () => {
  // XPP cannot reload in place; restart the page with the edited file and the
  // other files in the working folder
  const extras = (session?.listFiles() ?? [])
    .filter((f) => f.name !== odeName && f.size < 2_000_000)
    .map((f) => ({ name: f.name, data: toBase64(session!.readFile(f.name)) }))
  try {
    sessionStorage.setItem('xpp-edited', JSON.stringify({ name: odeName, text: $<HTMLTextAreaElement>('edtext').value, extras }))
  } catch {
    sessionStorage.setItem('xpp-edited', JSON.stringify({ name: odeName, text: $<HTMLTextAreaElement>('edtext').value, extras: [] }))
  }
  location.reload()
})

function toBase64(data: Uint8Array): string {
  let s = ''
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000))
  return btoa(s)
}

function restoreEdited(name: string | null) {
  try {
    const raw = sessionStorage.getItem('xpp-edited')
    if (!raw) return null
    sessionStorage.removeItem('xpp-edited')
    const d = JSON.parse(raw)
    if (!name || d.name !== name) return null
    const extras = (d.extras || []).map((f: { name: string; data: string }) => ({
      name: f.name,
      data: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)),
    }))
    return { name: d.name as string, text: d.text as string, extras }
  } catch {
    return null
  }
}

window.addEventListener('pagehide', () => terminal.closeAll())
