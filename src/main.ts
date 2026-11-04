import './style.css'
import { XppSession, xppBuild, type WindowImage } from './xpp'
import { Terminal, type TerminalMode } from './terminal'
import { download, makeZip } from './zip'
import { MobileUI, detectDevice, watchDevice, type ViewMode } from './mobile'
import { setupPwa } from './pwa'
import { lockRotation, setupApp, shareFile } from './android'
import { Loupe, SliderDrawer } from './touch'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header class="bar">
    <strong class="brand">XPPAUT-Web</strong>
    <button type="button" class="menubtn" id="menubtn" aria-label="Menu" aria-expanded="false">☰</button>
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
      <details class="settings" id="settings">
        <summary title="Exports, output and window options">Settings</summary>
        <div class="settings-panel">
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
          <label title="Phone and tablet layout: detected automatically, or choose one">View
            <select id="viewmode">
              <option value="auto">Automatic</option>
              <option value="mobile">Mobile (touch)</option>
              <option value="desktop">Desktop</option>
            </select>
          </label>
          <label class="touch-only" title="Keep the screen upright or sideways (in the app, or when installed)">Rotation
            <select id="rotation">
              <option value="auto">Automatic</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label class="check" title="Open XPP's new windows as separate browser windows (allow pop-ups for this site). Any window can also be popped out with ⧉ in its title bar.">
            <input type="checkbox" id="separate"> Separate windows
          </label>
        </div>
      </details>
      <button id="savesession" title="Download a .zip with everything XPP saved, screenshots of the open windows (SS folder) and XPP's output">Save session</button>
      <button id="restart">Restart</button>
    </div>
    <button type="button" class="install" id="install" hidden title="Install XPPAUT-Web as an app: its own window and icon, and it works offline">Install</button>
    <details class="themes" id="themes">
      <summary class="round" title="Theme" aria-label="Theme">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>
        </svg>
      </summary>
      <div class="themes-panel" id="themelist" role="menu"></div>
    </details>
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
  <dialog id="leave">
    <form method="dialog" class="leave">
      <h3 id="leavetitle">Save your session first?</h3>
      <p id="leavetext"></p>
      <div class="editor-foot">
        <button value="cancel" id="leavecancel">Cancel</button>
        <button value="discard" id="leavediscard">Continue without saving</button>
        <button value="save" id="leavesave" class="primary">Save and continue</button>
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

// Sing pts with "Print eigenvalues?" -> YES prints them as text, which
// phones and tablets do not show (no output panel there): show them in a card
let eigen: string[] | null = null
let eigenTimer = 0
function watchEigen(chunk: string) {
  for (const line of chunk.split('\n')) {
    if (/^\s*Eigenvalues:/.test(line)) {
      eigen = []
      continue
    }
    if (!eigen) continue
    const m = line.match(/^\s*(-?[\d.]+(?:e[-+]?\d+)?)\s+\+\s+i\s+(-?[\d.]+(?:e[-+]?\d+)?)/i)
    if (m) {
      const [re, im] = [Number(m[1]), Number(m[2])]
      eigen.push(im === 0 ? `${re}` : `${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)} i`)
      clearTimeout(eigenTimer)
      eigenTimer = window.setTimeout(showEigen, 200)
    } else if (line.trim()) showEigen()
  }
}
function showEigen() {
  const list = eigen
  eigen = null
  if (!list?.length || document.documentElement.dataset.device === 'desktop') return
  document.querySelector('.eigen')?.remove()
  const d = document.createElement('div')
  d.className = 'eigen'
  d.setAttribute('role', 'status')
  d.innerHTML = '<b>Eigenvalues</b><button type="button" aria-label="Close">×</button><ol></ol>'
  for (const e of list) d.querySelector('ol')!.append(Object.assign(document.createElement('li'), { textContent: e }))
  d.querySelector('button')!.addEventListener('click', () => d.remove())
  document.body.append(d)
}

function notice(msg: string) {
  $('status').textContent = msg
  $('status').title = msg
  setTimeout(() => ($('status').textContent = statusText), 7000)
  // phones and tablets: the status text is folded away, so show a toast too
  if (document.documentElement.dataset.device && document.documentElement.dataset.device !== 'desktop') {
    document.querySelector('.toast.notice')?.remove()
    const t = document.createElement('div')
    t.className = 'toast notice'
    t.setAttribute('role', 'status')
    t.textContent = msg
    t.addEventListener('click', () => t.remove())
    document.body.append(t)
    setTimeout(() => t.remove(), 6000)
  }
}

// ---- starting XPP -----------------------------------------------------------
async function launch(name: string, text: string, extras: Array<{ name: string; data: Uint8Array }> = [], id = name) {
  remember(id, name, text)
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
    onOutput: (line) => {
      terminal.write(line)
      watchEigen(line)
    },
    onNotice: notice,
    onFileWritten: exported,
    onExit: async (status) => {
      statusText = `${name}: XPP has quit`
      $('status').textContent = statusText
      if (unsaved && (await askToSave('quit')) === 'save') await saveSession()
      void status
    },
  })
  session.popOutNew = separate.checked
  mobile.attach(session)
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
    // XPP may already be running a file opened before the index arrived
    // (e.g. "Open with" in the app): do not replace it with an example
    if (session) return
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
// Android app: files opened with XPPAUT from other apps start XPP like Open .ode file…
setupApp(
  () => session ?? undefined,
  (files) => {
    const input = $<HTMLInputElement>('upload')
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(f)
    input.files = dt.files
    input.dispatchEvent(new Event('change'))
  },
  () => { leaving = true },
)
$('restart').addEventListener('click', () => leaveThen(() => location.reload()))
$('switch').addEventListener('change', () => {
  const sw = $('switch') as HTMLSelectElement
  const v = sw.value
  if (!v) return
  leaveThen(
    () => {
      const q = new URLSearchParams(location.search)
      q.set('ode', v)
      location.search = '?' + q.toString() // XPP restarts with the new model
    },
    () => (sw.value = odeId), // cancelled
  )
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
function exported(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  // AUTO's scratch files (fort.3, fort.7, ...) and its working results
  // (<model>.b/.d/.s, appended to on every run) are not exports
  if (/^fort\.\d+$/.test(name) || [odeName + '.b', odeName + '.d', odeName + '.s'].includes(name)) return
  // XPP sometimes reopens a file to append; deliver once it settles
  clearTimeout(pendingExports.get(path))
  pendingExports.set(path, setTimeout(() => deliverExport(path), 250))
  if (!path.startsWith('/work/')) savedElsewhere.add(path)
}

/** where XPP saved it, if not its working folder (shown in the notice) */
function folderNote(path: string): string {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/'
  return dir === '/work' ? '' : ` (XPP saved it in ${dir})`
}

async function deliverExport(path: string) {
  pendingExports.delete(path)
  updateFileCount()
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (!session || exportMode === 'files') {
    notice(folderNote(path) ? `Saved ${name} in XPP's ${path.slice(0, path.lastIndexOf('/'))}` : `Saved ${name} (see Files)`)
    return
  }
  let data: Uint8Array
  try {
    data = session.readFile(path)
  } catch {
    return // removed again (temporary file)
  }
  if (exportMode === 'folder' && exportDir) {
    try {
      const fh = await exportDir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(data as BlobPart)
      await w.close()
      notice(`Saved ${name} in "${exportDir.name}"${folderNote(path)}`)
      return
    } catch {
      notice(`Could not write to "${exportDir.name}"; downloading ${name} instead`)
    }
  }
  download(name, data)
  notice(`Downloaded ${name}${folderNote(path)}`)
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
  editor.close()
  leaveThen(restartEdited)
})

function restartEdited() {
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
}

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

// ---- auto-save: when the page is hidden (app in the background, tab
// switched, phone locked) keep the model, XPP's files and the current
// parameter and initial values, so they can be restored if the browser or
// Android closes the page. Offered on the start screen next time.
const AUTOSAVE = 'xpp-autosave'
interface AutoSave {
  id: string
  name: string
  text: string
  extras: Array<{ name: string; data: string }>
  values: Array<{ name: string; value: number; ic: boolean }>
  time: number
}
function autoSave() {
  if (!session?.running || !unsaved || leaving) return // leaving: the user chose to go
  try {
    let size = 0
    const extras = session.listFiles()
      .filter((f) => f.name !== odeName && !/^fort\.\d+$/.test(f.name) && (size += f.size) < 2_000_000)
      .map((f) => ({ name: f.name, data: toBase64(session!.readFile(f.name)) }))
    const snap: AutoSave = {
      id: odeId, name: odeName, text: new TextDecoder().decode(session.readFile(odeName)),
      extras, values: session.params(), time: Date.now(),
    }
    localStorage.setItem(AUTOSAVE, JSON.stringify(snap))
  } catch { /* storage full or blocked: nothing to restore */ }
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && autoSave())
window.addEventListener('pagehide', autoSave)

function offerRestore() {
  let snap: AutoSave | null = null
  try {
    snap = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null')
  } catch { /* none */ }
  if (!snap || Date.now() - snap.time > 30 * 86400_000 || new URLSearchParams(location.search).has('ode')) return
  const bar = document.createElement('div')
  bar.className = 'restore'
  const when = new Date(snap.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  bar.innerHTML = `<span>Your last session: <b></b> <small></small></span>
    <button type="button" class="restore-go">Restore</button>
    <button type="button" class="restore-no" aria-label="Forget it">×</button>`
  bar.querySelector('b')!.textContent = snap.name
  bar.querySelector('small')!.textContent = when
  const forget = () => {
    bar.remove()
    try { localStorage.removeItem(AUTOSAVE) } catch { /* ignore */ }
  }
  bar.querySelector('.restore-no')!.addEventListener('click', forget)
  bar.querySelector('.restore-go')!.addEventListener('click', async () => {
    const s = snap!
    forget()
    await launch(s.name, s.text, s.extras.map((f) => ({ name: f.name, data: Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0)) })), s.id)
    // once XPP is up, put the values back
    const t = setInterval(() => {
      if (!session?.running || session.busy || !session.windows().length) return
      clearInterval(t)
      for (const v of s.values) session.setValue(v.name, v.value, v.ic)
      notice('Restored ' + s.name + ': files and parameter/initial values')
    }, 300)
  })
  $('hint').prepend(bar)
}
offerRestore()

// ---- recent models (start screen): examples by name, your own files with
// their text (not their data files)
const RECENT = 'xpp-recent'
interface Recent {
  id: string
  name: string
  text?: string
  time: number
}
function recents(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || '[]')
  } catch {
    return []
  }
}
function remember(id: string, name: string, text: string) {
  const example = id.includes('/') && !!splitId(id)[0] // your own files have bare names
  if (!example && text.length > 200_000) return // too large to keep
  const entry: Recent = example ? { id, name, time: Date.now() } : { id, name, text, time: Date.now() }
  try {
    localStorage.setItem(RECENT, JSON.stringify([entry, ...recents().filter((r) => r.id !== id)].slice(0, 8)))
  } catch { /* storage full or blocked */ }
}
function showRecent() {
  const list = recents()
  if (!list.length) return
  const box = document.createElement('div')
  box.className = 'recent'
  box.innerHTML = '<span>Recent:</span>'
  for (const r of list) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = r.name
    b.title = r.text
      ? `Your file, opened ${new Date(r.time).toLocaleString()} (its data files are not kept)`
      : 'Example ' + r.id
    b.addEventListener('click', () => (r.text ? launch(r.name, r.text, [], r.id) : loadExample(r.id)))
    box.append(b)
  }
  const forget = document.createElement('button')
  forget.type = 'button'
  forget.className = 'recent-clear'
  forget.textContent = 'Clear'
  forget.title = 'Forget this list'
  forget.addEventListener('click', () => {
    box.remove()
    try { localStorage.removeItem(RECENT) } catch { /* ignore */ }
  })
  box.append(forget)
  $('hint').insertBefore(box, $('hint').querySelector('p'))
}
showRecent()

// ---- phones and tablets ---------------------------------------------------------
const viewSelect = $<HTMLSelectElement>('viewmode')
let viewMode = (store.get('xpp-view') as ViewMode) || 'auto'
viewSelect.value = viewMode
const mobile = new MobileUI(app, desktop)
mobile.tip = notice
// touch helpers: a loupe with XPP's coordinates, large sliders, sharing
const loupe = new Loupe(desktop, () => session)
loupe.enabled = () => mobile.device !== 'desktop'
const sliders = new SliderDrawer(desktop, () => session, notice)
mobile.addCommand('Sliders', 'parameters', () => sliders.toggle())
mobile.addCommand('Share graph', 'picture', () => {
  const main = session?.windowImages().find((w) => /^XPP Ver/.test(w.title))
  if (!main) return notice('No graph to share')
  main.canvas.toBlob((b) => b && void shareFile(baseName() + '.png', b, download), 'image/png')
})
mobile.addCommand('Data (CSV)', 'save', async () => {
  // written in XPP's folder: delivered like XPP's own exports (Settings -> Exports)
  const rows = await session!.writeCsv('/work/' + baseName() + '.csv')
  if (rows <= 0) notice('No data yet: integrate first')
})
mobile.addCommand('Share .ode', 'model', () => {
  void shareFile(odeName, new Blob([session!.readFile(odeName) as BlobPart], { type: 'text/plain' }), download)
})
function baseName() {
  return (odeName || 'xpp').replace(/\.ode$/i, '')
}
const updateDevice = () => mobile.apply(detectDevice(viewMode))
updateDevice()
watchDevice(updateDevice)
viewSelect.addEventListener('change', () => {
  viewMode = viewSelect.value as ViewMode
  store.set('xpp-view', viewMode)
  updateDevice()
})
// Settings -> Rotation (phones and tablets)
const rotationSelect = $<HTMLSelectElement>('rotation')
rotationSelect.value = store.get('xpp-rotation') || 'auto'
if (rotationSelect.value !== 'auto') void lockRotation(rotationSelect.value as 'portrait')
rotationSelect.addEventListener('change', async () => {
  const mode = rotationSelect.value as 'auto' | 'portrait' | 'landscape'
  if (await lockRotation(mode)) store.set('xpp-rotation', mode)
  else {
    rotationSelect.value = 'auto'
    notice("This browser can't lock the rotation; install XPPAUT-Web as an app (or use the phone's rotation lock)")
  }
})
// ☰ on phones: the toolbar folds into a menu
$('menubtn').addEventListener('click', () => {
  const open = document.querySelector('header')!.classList.toggle('menu-open')
  $('menubtn').setAttribute('aria-expanded', String(open))
})
document.addEventListener('pointerdown', (e) => {
  const h = document.querySelector('header')!
  if (h.classList.contains('menu-open') && !h.contains(e.target as Node)) {
    h.classList.remove('menu-open')
    $('menubtn').setAttribute('aria-expanded', 'false')
  }
}, true)

// ---- themes (colours of the page around XPP; XPP's windows keep their look) --
const THEMES: Array<{ id: string; name: string; swatch: string[] }> = [
  { id: 'system', name: 'System (light/dark)', swatch: ['#ffffff', '#5c6670', '#222326', '#2a3038'] },
  { id: 'light', name: 'Light', swatch: ['#ffffff', '#e6e6e1', '#5c6670', '#2f5d8a'] },
  { id: 'dark', name: 'Dark', swatch: ['#222326', '#34363a', '#2a3038', '#4b7fb3'] },
  { id: 'midnight', name: 'Midnight Blue', swatch: ['#101d36', '#1c3158', '#14274a', '#3d7bd9'] },
  { id: 'solarized-light', name: 'Solarized Light', swatch: ['#fdf6e3', '#eee8d5', '#586e75', '#268bd2'] },
  { id: 'solarized-dark', name: 'Solarized Dark', swatch: ['#002b36', '#073642', '#0a3a47', '#268bd2'] },
  { id: 'nord', name: 'Nord', swatch: ['#3b4252', '#4c566a', '#434c5e', '#5e81ac'] },
  { id: 'dracula', name: 'Dracula', swatch: ['#282a36', '#44475a', '#343746', '#bd93f9'] },
  { id: 'sepia', name: 'Sepia', swatch: ['#faf4e6', '#ebdfc4', '#7a6344', '#8b5a2b'] },
  { id: 'contrast', name: 'High Contrast', swatch: ['#000000', '#ffffff', '#000000', '#ffff00'] },
]

function applyTheme(id: string) {
  if (id === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = id
  for (const b of document.querySelectorAll<HTMLButtonElement>('#themelist button'))
    b.setAttribute('aria-checked', String(b.dataset.theme === id))
  // the phone's status bar / app title bar takes the toolbar's colour
  const bar = getComputedStyle(document.documentElement).getPropertyValue('--bar').trim()
  if (bar) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar)
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.get('xpp-theme') || 'system'))

{
  const list = $('themelist')
  for (const t of THEMES) {
    const b = document.createElement('button')
    b.type = 'button'
    b.setAttribute('role', 'menuitemradio')
    b.dataset.theme = t.id
    b.innerHTML = `<span class="swatch">${t.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`
    b.append(t.name)
    b.addEventListener('click', () => {
      applyTheme(t.id)
      store.set('xpp-theme', t.id)
      ;($('themes') as HTMLDetailsElement).open = false
    })
    list.append(b)
  }
  applyTheme(store.get('xpp-theme') || 'system') // index.html applied it early too
}

// toolbar menus (Settings, Files): Esc or a click elsewhere closes them.
// Capture phase, so XPP does not also get that Esc.
const openMenus = () => [...document.querySelectorAll<HTMLDetailsElement>('header details[open]')]
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape') return
    const open = openMenus()
    if (!open.length) return
    for (const d of open) d.open = false
    e.preventDefault()
    e.stopImmediatePropagation()
  },
  true,
)
document.addEventListener(
  'pointerdown',
  (e) => {
    for (const d of openMenus()) if (!d.contains(e.target as Node)) d.open = false
  },
  true,
)

// ---- session: save everything as one .zip; warn before leaving --------------
let unsaved = false // the user did something since the last "Save session"
let leaving = false // we are leaving on purpose (already asked)
const savedElsewhere = new Set<string>() // exports XPP wrote outside /work

for (const ev of ['pointerdown', 'keydown'])
  window.addEventListener(ev, () => {
    if (session?.running) unsaved = true
  }, true)

// closing the tab or reloading: browsers only allow their own generic prompt
window.addEventListener('beforeunload', (e) => {
  if (unsaved && !leaving) {
    e.preventDefault()
    e.returnValue = ''
  }
})

const leaveDialog = $<HTMLDialogElement>('leave')
function askToSave(kind: 'leave' | 'quit'): Promise<'save' | 'discard' | 'cancel'> {
  const quit = kind === 'quit'
  $('leavetitle').textContent = quit ? 'XPP has quit. Save this session?' : 'Save your session first?'
  $('leavetext').textContent =
    (quit ? '' : 'This session has work that has not been saved. ') +
    "Saving downloads a .zip file with everything XPP saved, screenshots of the open windows (in a folder named SS), and XPP's output."
  $('leavecancel').hidden = quit
  $('leavediscard').textContent = quit ? "Don't save" : 'Continue without saving'
  $('leavesave').textContent = quit ? 'Save session' : 'Save and continue'
  leaveDialog.returnValue = ''
  leaveDialog.showModal()
  return new Promise((resolve) =>
    leaveDialog.addEventListener(
      'close',
      () => resolve((leaveDialog.returnValue || 'cancel') as 'save' | 'discard' | 'cancel'),
      { once: true },
    ),
  )
}

/** Leave (restart, switch model, ...) after offering to save the session. */
async function leaveThen(go: () => void, cancelled: () => void = () => {}) {
  if (unsaved && session) {
    const answer = await askToSave('leave')
    if (answer === 'cancel') return cancelled()
    if (answer === 'save') await saveSession()
  }
  leaving = true
  go()
}

function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('no image'))), 'image/png'),
  )
}

/** one picture of all windows, placed as they were on screen */
function composite(imgs: WindowImage[]): HTMLCanvasElement | null {
  if (!imgs.length) return null
  const x0 = Math.min(...imgs.map((i) => i.x))
  const y0 = Math.min(...imgs.map((i) => i.y))
  const x1 = Math.max(...imgs.map((i) => i.x + i.canvas.width))
  const y1 = Math.max(...imgs.map((i) => i.y + i.canvas.height))
  const c = document.createElement('canvas')
  c.width = x1 - x0 + 16
  c.height = y1 - y0 + 16
  const g = c.getContext('2d')!
  g.fillStyle = '#5c6670'
  g.fillRect(0, 0, c.width, c.height)
  for (const i of imgs) {
    g.fillStyle = 'rgba(0,0,0,0.45)'
    g.fillRect(i.x - x0 + 7, i.y - y0 + 7, i.canvas.width + 2, i.canvas.height + 2)
    g.drawImage(i.canvas, i.x - x0 + 8, i.y - y0 + 8)
  }
  return c
}

async function saveSession() {
  if (!session) return
  const safe = (t: string) => t.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'window'
  const files: Array<{ name: string; data: Uint8Array }> = []
  for (const f of session.listFiles()) files.push({ name: 'files/' + f.name, data: session.readFile(f.name) })
  for (const p of savedElsewhere) {
    try {
      files.push({ name: 'files/other-folders' + p, data: session.readFile(p) })
    } catch {
      /* gone */
    }
  }
  const imgs = session.windowImages()
  let n = 1
  // SS/: screenshots of the windows as they are now (or were when XPP quit)
  for (const i of imgs) files.push({ name: `SS/${String(n++).padStart(2, '0')}-${safe(i.title)}.png`, data: await canvasPng(i.canvas) })
  const screen = composite(imgs)
  if (screen) files.push({ name: 'SS/00-all-windows.png', data: await canvasPng(screen) })
  files.push({ name: 'output.txt', data: new TextEncoder().encode(terminal.text()) })
  const when = new Date()
  files.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      `XPPAUT-Web session\n\nModel: ${odeName}\nSaved: ${when.toString()}\nSite: ${location.origin + location.pathname}\n\n` +
        `files/    everything in XPP's working folder (the model, data, plots, .set files, AUTO results)\n` +
        `SS/       screenshots of the XPP windows at the time of saving: one per window,\n` +
        `          and 00-all-windows.png with all of them as arranged on screen\n` +
        `output.txt XPP's terminal output\n`,
    ),
  })
  const p2 = (n: number) => String(n).padStart(2, '0')
  const stamp = `${when.getFullYear()}-${p2(when.getMonth() + 1)}-${p2(when.getDate())}_${p2(when.getHours())}-${p2(when.getMinutes())}`
  download(`${odeName.replace(/\.ode$/, '')}-session-${stamp}.zip`, makeZip(files))
  unsaved = false
  notice('Session saved')
}

$('savesession').addEventListener('click', () => void saveSession())

// ---- installable app: Install button; offer new versions when deployed ------
setupPwa($<HTMLButtonElement>('install'), (apply) => {
  const bar = document.createElement('div')
  bar.className = 'toast'
  bar.setAttribute('role', 'status')
  bar.innerHTML =
    '<span>A new version of XPPAUT-Web is available.</span>' +
    '<button type="button" class="primary">Update</button><button type="button">Later</button>'
  const [update, later] = bar.querySelectorAll('button')
  update.addEventListener('click', () => leaveThen(() => { bar.remove(); apply() }))
  later.addEventListener('click', () => bar.remove())
  document.querySelector('.toast')?.remove()
  document.body.append(bar)
})
