import './style.css'
import { XppSession, xppBuild } from './xpp'
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
      <label title="Switch to another example (restarts XPP)">Model
        <select id="switch"></select>
      </label>
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
          <p class="files-note">Everything XPP saves (Graphic stuff → Postscript/SVG, data, .set files, AUTO diagrams) is also downloaded or saved to your folder, as chosen under <b>Exports</b>. ⤓ on any window's title bar saves it as PNG.</p>
        </div>
      </details>
      <label title="What happens when XPP saves a file (plots, data, .set, AUTO diagrams)">Exports
        <select id="exportmode">
          <option value="download">Download</option>
          <option value="folder">Save to a folder…</option>
          <option value="files">Keep in Files only</option>
        </select>
      </label>
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
      <div class="hint" id="hint">
        <p>Pick an example or open your own <code>.ode</code> file to start XPP.</p>
        <div class="loadbar" id="loadbar" role="progressbar" aria-label="Loading XPP"><div id="loadfill"></div></div>
        <p class="loadtext" id="loadtext">Loading XPP…</p>
      </div>
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
let odeId = ''
let statusText = ''

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
  setTimeout(() => ($('status').textContent = statusText), 7000)
}

// ---- starting XPP -----------------------------------------------------------
async function launch(name: string, text: string, extras: Array<{ name: string; data: Uint8Array }> = [], id = name) {
  odeName = name
  odeId = id
  $('start').hidden = true
  $('session').hidden = false
  const sw = $('switch') as HTMLSelectElement
  sw.value = id
  if (sw.value !== id) sw.value = '' // not an example: "(your file)"
  statusText = sw.value ? '' : name // the switcher already names examples
  $('status').textContent = statusText
  const q = new URLSearchParams(location.search)
  q.set('ode', id) // keep other parameters (e.g. engine=asyncify for testing)
  history.replaceState(null, '', '?' + q.toString())
  // the user's click that started XPP can open the output window
  if (store.get('xpp-terminal') === 'window') termMode.value = terminal.setMode('window')
  session = new XppSession(desktop, {
    onOutput: (line) => terminal.write(line),
    onNotice: notice,
    onFileWritten: exported,
    onExit: (status) => {
      $('status').textContent = `${name} — XPP exited (${status})`
    },
  })
  session.popOutNew = separate.checked
  ;(window as unknown as { xpp: XppSession }).xpp = session // for tests and debugging
  setInterval(updateFileCount, 2000)
  // XPP's WebAssembly started downloading when the page opened; wait for it
  let wasm: ArrayBuffer | undefined
  try {
    wasm = await wasmReady
  } catch {
    wasm = undefined // fall back to a plain download inside start()
  }
  $('loadtext').textContent = 'Starting XPP…'
  await session.start(name, text, extras, wasm)
  $('hint')?.remove()
}

// ---- download XPP as soon as the page opens, with a progress bar -------------
const build = xppBuild()
const wasmReady: Promise<ArrayBuffer> = (async () => {
  const fill = $('loadfill')
  const label = $('loadtext')
  const mb = (n: number) => (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' MB'
  void fetch(build.dir + 'xppaut.mjs') // warm the cache for the loader script
  let total = 0
  try {
    total = (await (await fetch('wasm/sizes.json')).json())[build.engine] || 0
  } catch {
    /* no size: indeterminate */
  }
  const res = await fetch(build.dir + 'xppaut.wasm')
  if (!res.ok || !res.body) throw new Error('cannot download XPP')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    const f = total ? Math.min(1, got / total) : 0
    fill.style.width = (total ? f * 100 : 30 + ((got / 50000) % 60)) + '%'
    if (total) document.getElementById('loadbar')?.setAttribute('aria-valuenow', String(Math.round(f * 100)))
    label.textContent = total ? `Loading XPP… ${mb(got)} of ${mb(total)}` : `Loading XPP… ${mb(got)}`
  }
  const buf = new Uint8Array(got)
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  fill.style.width = '100%'
  label.textContent = 'XPP is ready.'
  setTimeout(() => document.getElementById('loadbar')?.classList.add('done'), 300) // may be gone already
  return buf.buffer
})()
wasmReady.catch(() => {
  $('loadtext').textContent = 'Could not download XPP. Check your connection and reload.'
})

interface ExampleGroup {
  id: string
  label: string
  odes: string[]
  data: string[]
}
let groups: ExampleGroup[] = []

/** "ode/lecar.ode" -> group and file name; a bare name means the main folder */
function splitId(id: string): [ExampleGroup | undefined, string] {
  const [g, n] = id.includes('/') ? [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)] : ['ode', id]
  const group = groups.find((x) => x.id === g)
  return [group?.odes.includes(n) ? group : undefined, n]
}

async function loadExample(id: string) {
  const [group, name] = splitId(id)
  if (!group) throw new Error(`no example ${id}`)
  const dir = 'odes/' + group.id + '/'
  const res = await fetch(dir + encodeURIComponent(name))
  if (!res.ok) throw new Error(`cannot load ${id}`)
  const text = await res.text()
  // bring along the data files the example uses: any bundled .ani/.tab/.dat
  // named in it, and the .ani of the same name (pend.ode + pend.ani)
  const wanted = new Set([name.replace(/\.ode$/, '.ani')])
  for (const m of text.matchAll(/[\w.+-]+\.(?:ani|tab|dat)\b/gi)) wanted.add(m[0])
  const extras: Array<{ name: string; data: Uint8Array }> = []
  for (const f of wanted) {
    if (!group.data.includes(f)) continue
    const r = await fetch(dir + encodeURIComponent(f))
    if (r.ok) extras.push({ name: f, data: new Uint8Array(await r.arrayBuffer()) })
  }
  await launch(name, text, extras, group.id + '/' + name)
}

function exampleOptions(): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return groups
    .map(
      (g) =>
        `<optgroup label="${esc(g.label)} (${g.odes.length})">` +
        g.odes.map((n) => `<option value="${esc(g.id + '/' + n)}">${esc(n)}</option>`).join('') +
        '</optgroup>',
    )
    .join('')
}

fetch('odes/index.json')
  .then((r) => r.json())
  .then((index: ExampleGroup[]) => {
    groups = index
    example.innerHTML = exampleOptions()
    ;($('switch') as HTMLSelectElement).innerHTML = '<option value="">(your file)</option>' + exampleOptions()
    example.value = 'ode/lecar.ode'
    const q = new URLSearchParams(location.search)
    const want = q.get('ode')
    const edited = restoreEdited(want)
    if (edited) launch(edited.name, edited.text, edited.extras, edited.id)
    else if (want && splitId(want)[0]) {
      example.value = splitId(want)[0]!.id + '/' + splitId(want)[1]
      loadExample(want)
    }
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
$('switch').addEventListener('change', () => {
  const v = ($('switch') as HTMLSelectElement).value
  if (!v) return
  const q = new URLSearchParams(location.search)
  q.set('ode', v)
  location.search = '?' + q.toString() // XPP restarts with the new model
})

separate.checked = store.get('xpp-separate') === '1'
separate.addEventListener('change', () => {
  if (session) session.popOutNew = separate.checked
  store.set('xpp-separate', separate.checked ? '1' : '0')
})

// ---- exports: files XPP writes are downloaded or saved to a chosen folder ----
type ExportMode = 'download' | 'folder' | 'files'
interface DirHandle {
  name: string
  getFileHandle(n: string, o: { create: boolean }): Promise<{ createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void> }> }>
}
const exportSelect = $<HTMLSelectElement>('exportmode')
const canPickFolder = 'showDirectoryPicker' in window
let exportMode: ExportMode = 'download'
let exportDir: DirHandle | null = null
if (!canPickFolder) {
  const opt = exportSelect.querySelector('option[value="folder"]') as HTMLOptionElement
  opt.disabled = true
  opt.textContent = 'Save to a folder… (Chrome/Edge only)'
}
{
  const saved = store.get('xpp-exports')
  if (saved === 'files' || saved === 'download') exportMode = saved
  exportSelect.value = exportMode // a folder has to be picked again after reloading
}
exportSelect.addEventListener('change', async () => {
  const want = exportSelect.value as ExportMode
  if (want === 'folder') {
    try {
      const pick = (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker
      exportDir = await pick({ mode: 'readwrite', id: 'xpp-exports' })
      exportMode = 'folder'
      notice(`XPP will save files in the folder "${exportDir.name}"`)
    } catch {
      exportSelect.value = exportMode // cancelled: keep the previous choice
    }
    return
  }
  exportMode = want
  store.set('xpp-exports', want)
})

const pendingExports = new Map<string, ReturnType<typeof setTimeout>>()
function exported(name: string) {
  if (/^fort\.\d+$/.test(name)) return // AUTO's scratch files
  // XPP sometimes reopens a file to append; deliver once it settles
  clearTimeout(pendingExports.get(name))
  pendingExports.set(name, setTimeout(() => deliverExport(name), 250))
}

async function deliverExport(name: string) {
  pendingExports.delete(name)
  updateFileCount()
  if (!session || exportMode === 'files') {
    notice(`Saved ${name} (see Files)`)
    return
  }
  let data: Uint8Array
  try {
    data = session.readFile(name)
  } catch {
    return // removed again (temporary file)
  }
  if (exportMode === 'folder' && exportDir) {
    try {
      const fh = await exportDir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(data as BlobPart)
      await w.close()
      notice(`Saved ${name} in "${exportDir.name}"`)
      return
    } catch {
      notice(`Could not write to "${exportDir.name}"; downloading ${name} instead`)
    }
  }
  download(name, data)
  notice(`Downloaded ${name}`)
}

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
    sessionStorage.setItem('xpp-edited', JSON.stringify({ id: odeId, name: odeName, text: $<HTMLTextAreaElement>('edtext').value, extras }))
  } catch {
    sessionStorage.setItem('xpp-edited', JSON.stringify({ id: odeId, name: odeName, text: $<HTMLTextAreaElement>('edtext').value, extras: [] }))
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
    if (!name || (d.id || d.name) !== name) return null
    const extras = (d.extras || []).map((f: { name: string; data: string }) => ({
      name: f.name,
      data: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)),
    }))
    return { id: (d.id || d.name) as string, name: d.name as string, text: d.text as string, extras }
  } catch {
    return null
  }
}

window.addEventListener('pagehide', () => terminal.closeAll())
