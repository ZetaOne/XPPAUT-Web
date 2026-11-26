// The editor (editor.html, its own tab): XPP's workspace (and a folder on the
// computer, where the browser allows it) with tabs, two editor groups,
// previews, live checking of .ode files, and Run buttons that work through
// XPP's tab. Monaco on computers, CodeMirror on phones and tablets.
import './editor.css'
import * as ws from '../workspace'
import { makeZip, download } from '../zip'
import { unzip } from './unzip'
import { loadEngine, type Engine, type EditorView, type EngineOpts, type Mark } from './engine'
import { THEMES, followSite, applyUiColours, type Palette } from './themes'
import { kindOf, imagePreview, pdfPreview, psPreview, dataPreview, type Kind, type Preview } from './preview'
import { languageOf } from './lang'
import { parseKeys } from '../commands'

// ---- settings ------------------------------------------------------------------
type Style = 'auto' | 'monaco' | 'codemirror'
interface Settings {
  theme: string // 'site' or a THEMES id
  style: Style
  fontSize: number
  wrap: boolean
  minimap: boolean
  autosave: boolean
  reopenFolder: boolean // open the last folder every time
}
const KEY = 'xpp-editor-settings'
const settings: Settings = (() => {
  const d: Settings = { theme: 'site', style: 'auto', fontSize: 14, wrap: false, minimap: true, autosave: true, reopenFolder: true }
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return d
  }
})()
const saveSettings = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* private mode */
  }
}
const touchy = () => matchMedia('(pointer: coarse)').matches || innerWidth < 760
const engineKind = (): 'monaco' | 'codemirror' => (settings.style === 'auto' ? (touchy() ? 'codemirror' : 'monaco') : settings.style)
const palette = (): Palette => (settings.theme === 'site' ? followSite() : THEMES.find((t) => t.id === settings.theme) ?? followSite())

// ---- the frame ----------------------------------------------------------------
const root = document.getElementById('ed')!
root.innerHTML = `
  <header class="ed-title">
    <button type="button" id="sidebtn" title="Files (explorer)" aria-label="Files">☰</button>
    <span class="brand"><img src="./editor-icon-192.png" alt="">XPPAUT editor</span>
    <button type="button" id="newbtn" title="New file in the workspace">New</button>
    <button type="button" id="upbtn" title="Add files to the workspace">Add files</button>
    <button type="button" id="folderbtn" class="wide" title="Open a folder on this computer: edit its files in place">Open folder</button>
    <button type="button" id="savebtn" title="Save (Ctrl/Cmd+S)">Save</button>
    <button type="button" id="runbtn" class="run" disabled title="Run the model in XPP, or the script">▶ Run</button>
    <button type="button" id="splitbtn" class="wide" title="Split: a second editor group to the right">Split</button>
    <button type="button" id="winbtn" class="wide" title="A new editor window (all windows share the same files)">New window</button>
    <span class="grow"></span>
    <button type="button" id="xppbtn" title="Back to XPP">XPP</button>
    <button type="button" id="setbtn" title="Theme, editor style, font size…" aria-label="Settings">⚙</button>
    <input type="file" id="upinput" multiple hidden>
    <input type="file" id="zipinput" accept=".zip" hidden>
    <input type="file" id="dirinput" webkitdirectory multiple hidden>
  </header>
  <main class="ed-main" id="main">
    <aside class="ed-side" id="side">
      <div class="sideview" role="tablist">
        <button type="button" role="tab" data-v="web" title="Files kept in this browser, one folder per model (shared with XPP's tab)">Web files</button>
        <button type="button" role="tab" data-v="local" title="A folder on this device">Local files</button>
      </div>
      <div id="webpart">
        <h2><span>Models in this browser</span><button type="button" id="wsmenu" title="More: new model, add files, download all, restore, empty">⋯</button></h2>
        <ul class="tree" id="wstree"></ul>
      </div>
      <div id="localpart" hidden>
        <h2><span id="foldername">No folder</span><button type="button" id="localmenu" title="More: choose another folder, read it again, forget it">⋯</button></h2>
        <ul class="tree" id="foldertree"></ul>
      </div>
      <div class="storage" id="storage" hidden>
        <div class="smeter"><span id="sbar"></span></div>
        <div class="stext" id="stext"></div>
        <div class="snote" id="snote" hidden></div>
      </div>
    </aside>
    <div class="split v" id="sidesplit"></div>
    <div class="groups" id="groups"></div>
  </main>
  <div class="ed-panel-wrap closed" id="panelwrap">
    <div class="split h" id="panelsplit"></div>
    <section class="ed-panel">
      <div class="ptabs">
        <button type="button" data-p="terminal" class="on">Terminal</button>
        <button type="button" data-p="problems" id="ptab-problems">Problems</button>
        <button type="button" data-p="sliders">Sliders</button>
        <span class="grow"></span>
        <span class="ptools" data-for="terminal"><button type="button" id="termclear" title="Clear">Clear</button><button type="button" id="termcopy" title="Copy all">Copy</button><button type="button" id="termsave" title="Save as a file in the workspace">Save</button></span>
        <button type="button" id="panelclose" title="Close the panel">×</button>
      </div>
      <div class="cmdbar" id="cmdbar" title="XPP's commands (in XPP's tab)"></div>
      <div class="pbody" data-p="terminal"><pre class="term" id="term"></pre></div>
      <div class="pbody" data-p="problems" hidden><ul class="problems" id="problems"></ul></div>
      <div class="pbody" data-p="sliders" hidden><div class="sliders" id="sliders"></div></div>
    </section>
  </div>
  <footer class="ed-status">
    <span id="st-file"></span><span id="st-lang"></span>
    <button type="button" id="st-problems" title="Problems">⨂ 0 ⚠ 0</button>
    <button type="button" id="st-terminal" title="Terminal, XPP's commands and sliders">▤ Terminal</button>
    <span class="grow"></span>
    <button type="button" id="st-store" title="Storage used in this browser"></button>
    <span id="st-xpp" title="XPP's tab"></span><span id="st-engine"></span>
  </footer>`
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

function toast(msg: string, ms = 2800) {
  document.querySelector('.toast')?.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.append(t)
  setTimeout(() => t.remove(), ms)
}

// ---- engines and theme ----------------------------------------------------------
let engine: Engine | null = null
async function getEngine(): Promise<Engine> {
  if (engine && engine.name === engineKind()) return engine
  const e = await loadEngine(engineKind())
  e.setTheme(palette())
  e.setOptions(engineOpts())
  engine = e
  $('st-engine').textContent = e.name === 'monaco' ? 'VS Code style' : 'Touch style'
  return e
}
const engineOpts = (): EngineOpts => ({ fontSize: settings.fontSize, wrap: settings.wrap || touchy(), minimap: settings.minimap && !touchy(), onSave: () => void saveTab(activeTab()) })
function applyTheme() {
  const p = palette()
  applyUiColours(p)
  engine?.setTheme(p)
  for (const g of groups) for (const t of g.tabs) if (t.kind === 'data') void reloadTab(t) // plot colours
}

// ---- tabs and groups --------------------------------------------------------------
type Source =
  /** the workspace (this browser): "folder/name" */
  | { kind: 'ws'; name: string }
  /** a folder on the computer, edited in place (Chrome, Edge) */
  | { kind: 'folder'; path: string; handle: FileSystemFileHandle }
  /** other browsers: a copy read from a folder; saving downloads the file */
  | { kind: 'copy'; path: string }
interface Tab {
  id: string
  src: Source
  title: string
  kind: Kind
  asText: boolean // a data file opened as text
  pane: HTMLElement
  view: EditorView | null
  preview: Preview | null
  dirty: boolean
  marks: Mark[]
  tabEl: HTMLElement
}
interface Group {
  el: HTMLElement
  tabsEl: HTMLElement
  body: HTMLElement
  tabs: Tab[]
  active: Tab | null
}
const groups: Group[] = []
let focused = 0
const srcKey = (s: Source) => (s.kind === 'ws' ? 'ws:' + s.name : s.kind === 'folder' ? 'fs:' + s.path : 'cp:' + s.path)
const srcLabel = (s: Source) => (s.kind === 'ws' ? s.name : s.path)
const activeTab = (): Tab | null => groups[focused]?.active ?? null

function makeGroup(): Group {
  const el = document.createElement('section')
  el.className = 'group'
  const tabsEl = document.createElement('div')
  tabsEl.className = 'tabs'
  const body = document.createElement('div')
  body.className = 'body'
  el.append(tabsEl, body)
  const g: Group = { el, tabsEl, body, tabs: [], active: null }
  el.addEventListener('mousedown', () => focusGroup(groups.indexOf(g)))
  el.addEventListener('touchstart', () => focusGroup(groups.indexOf(g)), { passive: true })
  // tabs dropped here (from the other group, or files from the explorer)
  tabsEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    tabsEl.classList.add('drop')
  })
  tabsEl.addEventListener('dragleave', () => tabsEl.classList.remove('drop'))
  tabsEl.addEventListener('drop', (e) => {
    e.preventDefault()
    tabsEl.classList.remove('drop')
    const d = e.dataTransfer?.getData('text/x-xpp')
    if (!d) return
    const [what, key] = d.split('|')
    const gi = groups.indexOf(g)
    if (what === 'tab') moveTab(key, gi)
    else if (what === 'ws') void openFile({ kind: 'ws', name: key }, gi)
  })
  return g
}

function layoutGroups() {
  const box = $('groups')
  box.replaceChildren()
  if (groups.length === 1) {
    box.style.gridTemplateColumns = '1fr'
    box.append(groups[0].el)
  } else {
    box.style.gridTemplateColumns = `var(--g1, 1fr) 4px 1fr`
    const sp = document.createElement('div')
    sp.className = 'split v'
    dragSplit(sp, 'x', (dx, start) => box.style.setProperty('--g1', Math.max(180, Math.min(box.clientWidth - 180, start + dx)) + 'px'), () => groups[0].el.clientWidth)
    box.append(groups[0].el, sp, groups[1].el)
  }
  for (const g of groups) for (const t of g.tabs) t.view?.layout()
  focusGroup(Math.min(focused, groups.length - 1))
}

function focusGroup(i: number) {
  focused = Math.max(0, i)
  groups.forEach((g, k) => g.el.classList.toggle('focus', k === focused && groups.length > 1))
  updateChrome()
}

function welcome(g: Group) {
  if (g.tabs.length) return
  g.body.innerHTML = `<div class="welcome"><div><h1>XPPAUT editor</h1>
    <p>Pick a file on the left (☰ on phones), or <b>New</b>.</p>
    <p>${touchy() ? '' : '<kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> saves · <kbd>F1</kbd> commands · drag tabs between groups · '}▶ Run sends a model or a script to XPP.</p></div></div>`
}

async function openFile(src: Source, gi = focused, asText = false): Promise<Tab | null> {
  const key = srcKey(src)
  // already open in that group: show it (another group may have it too, as in VS Code)
  const here = (groups[gi] ?? groups[0]).tabs.find((x) => srcKey(x.src) === key && x.asText === asText)
  if (here) {
    showTab(groups.findIndex((g) => g.tabs.includes(here)), here)
    return here
  }
  const data = await readSource(src)
  if (!data) {
    toast('Cannot read ' + srcLabel(src))
    return null
  }
  const title = src.kind === 'ws' ? ws.baseOf(src.name) : src.path.split('/').pop()!
  const g = groups[gi] ?? groups[0]
  if (!g.tabs.length) g.body.replaceChildren()
  const pane = document.createElement('div')
  pane.className = 'pane'
  g.body.append(pane)
  const tabEl = document.createElement('div')
  tabEl.className = 'tab'
  tabEl.draggable = true
  const t: Tab = { id: Math.random().toString(36).slice(2), src, title, kind: kindOf(title, data), asText, pane, view: null, preview: null, dirty: false, marks: [], tabEl }
  tabEl.innerHTML = `<span class="tt"></span><button type="button" class="x" aria-label="Close"></button>`
  tabEl.querySelector('.tt')!.textContent = title + (asText ? ' (text)' : '')
  tabEl.title = (src.kind === 'ws' ? 'In this browser: ' : src.kind === 'folder' ? 'Local folder: ' : 'Local copy: ') + srcLabel(src)
  tabEl.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('x')) return void closeTab(t)
    showTab(groups.findIndex((x) => x.tabs.includes(t)), t)
  })
  tabEl.addEventListener('auxclick', (e) => e.button === 1 && closeTab(t))
  tabEl.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-xpp', 'tab|' + t.id))
  // reorder within a group: drop on a tab
  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    tabEl.classList.add('drop-before')
  })
  tabEl.addEventListener('dragleave', () => tabEl.classList.remove('drop-before'))
  tabEl.addEventListener('drop', (e) => {
    e.preventDefault()
    e.stopPropagation()
    tabEl.classList.remove('drop-before')
    const d = e.dataTransfer?.getData('text/x-xpp') ?? ''
    if (d.startsWith('tab|')) moveTab(d.slice(4), groups.findIndex((x) => x.tabs.includes(t)), t)
  })
  g.tabs.push(t)
  g.tabsEl.append(tabEl)
  await fillTab(t, data)
  showTab(groups.indexOf(g), t)
  return t
}

async function fillTab(t: Tab, data: Uint8Array) {
  t.view?.dispose()
  t.preview?.dispose()
  t.view = null
  t.preview = null
  t.pane.replaceChildren()
  if (t.kind === 'text' || t.asText) {
    const e = await getEngine()
    t.view = e.create(t.pane, ws.textOf(data), languageOf(t.title), engineOpts())
    t.view.onChange(() => {
      setDirty(t, true)
      scheduleCheck(t)
      if (settings.autosave && t.src.kind !== 'copy') scheduleSave(t) // a copy saves by downloading: only on Save
    })
    scheduleCheck(t)
    applyRunLine(t)
  } else if (t.kind === 'image') t.preview = imagePreview(t.title, data)
  else if (t.kind === 'pdf') t.preview = pdfPreview(t.title, data)
  else if (t.kind === 'ps') t.preview = psPreview(t.title, data)
  else if (t.kind === 'data') {
    const p = palette()
    t.preview = dataPreview(t.title, ws.textOf(data), [p.keyword, p.string, p.number, p.func, p.deriv, p.command, p.option, p.error])
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.textContent = 'Edit as text'
    edit.addEventListener('click', () => void openFile(t.src, groups.findIndex((g) => g.tabs.includes(t)), true))
    t.preview.el.querySelector('.pv-bar')?.append(edit)
  } else {
    t.pane.innerHTML = '<div class="welcome"><div><p>This file is not text.</p></div></div>'
    const b = document.createElement('button')
    b.textContent = 'Download it'
    b.addEventListener('click', async () => {
      const d = await readSource(t.src)
      if (d) download(t.title, d)
    })
    t.pane.querySelector('.welcome div')!.append(b)
  }
  if (t.preview) t.pane.append(t.preview.el)
}

function showTab(gi: number, t: Tab) {
  const g = groups[gi]
  if (!g) return
  g.active = t
  for (const x of g.tabs) {
    x.pane.classList.toggle('on', x === t)
    x.tabEl.classList.toggle('active', x === t)
  }
  t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  t.view?.layout()
  focusGroup(gi)
  closeSide()
}

function setDirty(t: Tab, on: boolean) {
  t.dirty = on
  t.tabEl.classList.toggle('dirty', on)
  updateChrome()
}

async function closeTab(t: Tab) {
  if (t.dirty && !settings.autosave && !confirm(`Close ${t.title} without saving?`)) return
  if (t.dirty) await saveTab(t)
  const g = groups.find((x) => x.tabs.includes(t))!
  const i = g.tabs.indexOf(t)
  g.tabs.splice(i, 1)
  t.view?.dispose()
  t.preview?.dispose()
  t.pane.remove()
  t.tabEl.remove()
  if (g.active === t) {
    g.active = null
    const next = g.tabs[Math.min(i, g.tabs.length - 1)]
    if (next) showTab(groups.indexOf(g), next)
  }
  if (!g.tabs.length) {
    if (groups.length > 1) {
      groups.splice(groups.indexOf(g), 1)
      layoutGroups()
    } else welcome(g)
  }
  updateChrome()
}

/** move tab `id` to group `gi` (before `before`, if given) */
function moveTab(id: string, gi: number, before?: Tab) {
  const from = groups.find((g) => g.tabs.some((t) => t.id === id))
  const to = groups[gi]
  if (!from || !to) return
  const t = from.tabs.find((x) => x.id === id)!
  if (t === before) return
  from.tabs.splice(from.tabs.indexOf(t), 1)
  if (!to.tabs.length) to.body.replaceChildren()
  const at = before ? to.tabs.indexOf(before) : to.tabs.length
  to.tabs.splice(at < 0 ? to.tabs.length : at, 0, t)
  to.body.append(t.pane)
  if (before) to.tabsEl.insertBefore(t.tabEl, before.tabEl)
  else to.tabsEl.append(t.tabEl)
  if (from.active === t) {
    from.active = null
    if (from.tabs.length) showTab(groups.indexOf(from), from.tabs[from.tabs.length - 1])
  }
  if (!from.tabs.length && from !== to) {
    if (groups.length > 1) {
      groups.splice(groups.indexOf(from), 1)
      layoutGroups()
    } else welcome(from)
  }
  showTab(groups.indexOf(to), t)
}

function split() {
  if (touchy()) return toast('Split view is for larger screens')
  if (groups.length > 1) {
    // merge: the second group's tabs come back to the first
    for (const t of [...groups[1].tabs]) moveTab(t.id, 0)
    return
  }
  const t = activeTab()
  groups.push(makeGroup())
  layoutGroups()
  welcome(groups[1])
  focusGroup(1)
  if (t) void openFile(t.src, 1, t.asText)
}

// ---- reading and saving --------------------------------------------------------
async function readSource(s: Source): Promise<Uint8Array | null> {
  if (s.kind === 'ws') return ws.read(s.name)
  if (s.kind === 'copy') return localCopy?.files.get(s.path) ?? null
  try {
    return new Uint8Array(await (await s.handle.getFile()).arrayBuffer())
  } catch {
    return null
  }
}

const saveTimers = new Map<string, number>()
function scheduleSave(t: Tab) {
  clearTimeout(saveTimers.get(t.id))
  saveTimers.set(t.id, window.setTimeout(() => void saveTab(t), 900))
}

async function saveTab(t: Tab | null) {
  if (!t || !t.view) return
  const text = t.view.getValue()
  try {
    if (t.src.kind === 'ws') await ws.write(t.src.name, ws.bytesOf(text))
    else if (t.src.kind === 'copy') {
      // this browser cannot write into the folder: keep the copy, download the file
      localCopy?.files.set(t.src.path, ws.bytesOf(text))
      if (localCopy) void keepCopy(localCopy)
      download(t.title, ws.bytesOf(text))
      toast(`${t.title} saved to your downloads (this browser cannot write into the folder)`, 4000)
    } else {
      const w = await t.src.handle.createWritable()
      await w.write(text)
      await w.close()
    }
    setDirty(t, false)
    // the same file open in the other group: show what was saved
    for (const g of groups) for (const o of g.tabs) if (o !== t && srcKey(o.src) === srcKey(t.src) && o.view && !o.dirty) o.view.setValue(text)
  } catch (e) {
    toast('Could not save: ' + (e as Error).message, 5000)
  }
}

/** reload an open tab from where it lives (another tab changed it) */
async function reloadTab(t: Tab) {
  const d = await readSource(t.src)
  if (!d) return
  if (t.view) {
    if (!t.dirty) t.view.setValue(ws.textOf(d))
    setDirty(t, false)
  } else await fillTab(t, d)
}

// ---- checking .ode files with XPP itself ---------------------------------------
const checkTimers = new Map<string, number>()
function scheduleCheck(t: Tab) {
  if (languageOf(t.title) !== 'ode' || !t.view) return
  clearTimeout(checkTimers.get(t.id))
  checkTimers.set(
    t.id,
    window.setTimeout(async () => {
      try {
        const { checkOde } = await import('../odecheck')
        const issues = await checkOde(t.view!.getValue())
        t.marks = issues
        t.view?.setMarks(issues)
      } catch {
        t.marks = []
      }
      updateChrome()
    }, 900),
  )
}

// ---- running in XPP --------------------------------------------------------------
let xppHere: { ode: string; dir: string; at: number } | null = null
ws.onMessage((m) => {
  if (m.t === 'xpp-here') {
    const changed = xppHere?.ode !== m.ode
    xppHere = { ode: m.ode, dir: m.dir ?? '', at: Date.now() }
    updateXpp()
    if (changed) ws.post({ t: 'params-req' })
  } else if (m.t === 'out') termWrite(m.lines)
  else if (m.t === 'script-line') {
    runLine = { name: m.name, line: m.line }
    for (const g of groups) for (const t of g.tabs) applyRunLine(t)
  } else if (m.t === 'params') fillSliders(m.list, m.sliders)
  else if (m.t === 'slider-ok') {
    const r = sliderRows[m.k]
    if (r) r.ready = m.ok
    if (!m.ok) toast('XPP could not put that on a slider')
  } else if (m.t === 'changed') {
    void refreshTree()
    for (const g of groups) for (const t of g.tabs) if (t.src.kind === 'ws' && t.src.name === m.name) void reloadTab(t)
  } else if (m.t === 'deleted' || m.t === 'cleared') void refreshTree()
})
const ping = () => ws.post({ t: 'hello' })
setInterval(ping, 5000)
ping()
const xppAlive = () => !!xppHere && Date.now() - xppHere.at < 12000
function updateXpp() {
  $('st-xpp').textContent = xppAlive() ? `XPP: ${xppHere!.ode || 'running'}` : 'XPP: not open'
  $('cmdbar').classList.toggle('off', !xppAlive())
}
setInterval(updateXpp, 3000)

async function run() {
  const t = activeTab()
  if (!t) return
  showPanel('terminal')
  if (t.dirty) await saveTab(t)
  // a local file: it and the files beside it go into the model's folder here first
  const name = t.src.kind === 'ws' ? t.src.name : await localToWs(t.src)
  if (!name) return
  const lang = languageOf(name)
  const dir = ws.dirOf(name)
  const base = ws.baseOf(name)
  if (lang === 'ode') {
    if (xppAlive()) {
      ws.post({ t: 'run-ode', name })
      toast(`Running ${base} in XPP's tab`)
    } else window.open('index.html?ws=' + encodeURIComponent(name), 'xpp-main')
  } else if (lang === 'xps') {
    if (xppAlive() && xppHere!.dir === dir) {
      ws.post({ t: 'run-script', name })
      toast(`Running ${base} in XPP's tab`)
      return
    }
    // XPP runs another model (or none): start this folder's model, then the script
    const model = await modelIn(dir)
    if (model) {
      if (xppAlive()) {
        ws.post({ t: 'run-ode', name: model, script: base })
        toast(`Starting ${ws.baseOf(model)} in XPP's tab, then ${base}`)
      } else window.open(`index.html?ws=${encodeURIComponent(model)}&script=${encodeURIComponent(base)}`, 'xpp-main')
    } else if (xppAlive()) {
      ws.post({ t: 'run-script', name })
      toast(`No model in ${dir}: running ${base} with the model XPP has open`)
    } else toast(`No model (.ode) in ${dir}: add one, or open XPP with a model first`)
  }
}

/** the model of a folder: the .ode named like the folder, or its first .ode */
async function modelIn(dir: string): Promise<string | null> {
  const odes = (await ws.list()).map((f) => f.name).filter((n) => ws.dirOf(n) === dir && /\.ode$/i.test(n))
  return odes.find((n) => ws.folderFor(ws.baseOf(n)) === dir) ?? odes[0] ?? null
}

// ---- the explorer: Web files (this browser, a folder per model) | Local files ----
const icon = (name: string) => {
  const k = kindOf(name)
  if (/\.ode$/i.test(name)) return '∂'
  if (/\.xps$/i.test(name)) return '▶'
  return k === 'image' ? '🖼' : k === 'ps' || k === 'pdf' ? '📄' : k === 'data' ? '📈' : '·'
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private mode */
    }
  },
}

/** which list the explorer shows (remembered) */
function setView(v: 'web' | 'local') {
  store.set('xpp-editor-view', v)
  for (const b of document.querySelectorAll<HTMLButtonElement>('.sideview button')) {
    b.classList.toggle('on', b.dataset.v === v)
    b.setAttribute('aria-selected', String(b.dataset.v === v))
  }
  $('webpart').hidden = v !== 'web'
  $('localpart').hidden = v !== 'local'
  if (v === 'local') renderLocal()
}

/** folders opened or closed by hand (the others: only the most recent is open) */
const folderOpen: Record<string, boolean> = (() => {
  try {
    return JSON.parse(store.get('xpp-editor-folders') ?? '{}')
  } catch {
    return {}
  }
})()
const keepFolderOpen = () => store.set('xpp-editor-folders', JSON.stringify(folderOpen))

function sizeText(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' kB'
  if (n < 1024 ** 3) return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB'
  return (n / 1024 ** 3).toFixed(1) + ' GB'
}

// ---- storage: how much the files take, and how close the browser's limit is ----
// The browser gives the site a quota (shared with XPP's own cached program).
// Amber from 70 % of it, red from 90 % or when less than 50 MB is left: then
// the browser may refuse new files or, if it runs short of disk, delete the
// site's data.
let storageLevel: 'ok' | 'warn' | 'full' = 'ok'
async function updateStorage(all?: Awaited<ReturnType<typeof ws.folders>>) {
  const folders = all ?? (await ws.folders())
  const files = folders.reduce((n, g) => n + g.files.reduce((m, f) => m + f.size, 0), 0)
  let usage = 0
  let quota = 0
  let persisted = false
  try {
    const e = await navigator.storage.estimate()
    usage = e.usage ?? 0
    quota = e.quota ?? 0
    persisted = (await navigator.storage.persisted?.()) ?? false
  } catch {
    /* not available (old browser, private window) */
  }
  const frac = quota ? usage / quota : 0
  const left = quota - usage
  const level = !quota ? 'ok' : frac >= 0.9 || left < 50 * 1024 * 1024 ? 'full' : frac >= 0.7 ? 'warn' : 'ok'
  const bar = $('sbar')
  bar.style.width = Math.min(100, Math.max(1, frac * 100)).toFixed(1) + '%'
  $('storage').hidden = false
  $('storage').className = 'storage ' + level
  $('stext').textContent = quota
    ? `Your files: ${sizeText(files)} · site total ${sizeText(usage)} of ${sizeText(quota)} (${(frac * 100).toFixed(frac < 0.1 ? 1 : 0)} %)`
    : `Your files: ${sizeText(files)}`
  $('storage').title =
    (level === 'full'
      ? 'Almost full: the browser may refuse new files. Download what you want to keep (⋯ → Download all) and delete folders you no longer need.'
      : level === 'warn'
        ? 'Getting full: download a copy of your files (⋯ → Download all) and delete folders you no longer need.'
        : 'Storage this site uses in the browser (your files, XPP\'s cached program and examples).') +
    (persisted ? '' : ' The browser may clear it when the disk runs low; ⋯ → Keep my files asks it not to.')
  // what this browser may do to the files
  const risk = browserRisk(persisted)
  const note = $('snote')
  note.hidden = !risk || !files
  note.textContent = risk?.text ?? ''
  note.classList.toggle('strong', !!risk?.nag)
  // Safari's 7 days: a reminder at most every 3 days, when there are files to lose
  if (risk?.nag && files && !remindedRecently()) {
    toast(risk.text, 9000)
    remindedNow()
  }
  const st = $('st-store')
  st.textContent = '💾 ' + sizeText(files)
  st.className = level
  st.title = $('storage').title
  if (level !== storageLevel && level !== 'ok') toast(level === 'full' ? 'Storage is almost full: download your files and delete folders you no longer need' : 'Storage is getting full', 6000)
  storageLevel = level
}
setInterval(() => void updateStorage(), 30000)

/** what this browser does with a site's files (null: nothing to warn about) */
function browserRisk(persisted: boolean): { text: string; nag: boolean } | null {
  const ua = navigator.userAgent
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR|Android/.test(ua)
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  if ((ios || safari) && !installed)
    return {
      text: `${ios ? 'On iPhone and iPad' : 'Safari'}: files of a site not visited for 7 days are deleted. ${ios ? 'Add this site to the Home Screen (Share → Add to Home Screen)' : 'Add this site to the Dock (File → Add to Dock)'} to keep them, and use Download all for a copy.`,
      nag: true,
    }
  if (persisted) return null
  if (/Firefox\//.test(ua)) return { text: 'Firefox may delete these files when the disk runs low. ⋯ → Keep my files asks it not to; Download all keeps a copy.', nag: false }
  return { text: 'The browser may delete these files when the disk runs low. ⋯ → Keep my files asks it not to; Download all keeps a copy.', nag: false }
}

const REMIND = 'xpp-editor-reminded'
const remindedRecently = () => Date.now() - Number(store.get(REMIND) ?? 0) < 3 * 86400e3
const remindedNow = () => store.set(REMIND, String(Date.now()))

function ago(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  if (s < 2 * 86400) return 'yesterday'
  return new Date(t).toLocaleDateString()
}

/** the folder new files go into: the open file's, else the most recent */
async function currentDir(): Promise<string> {
  const t = activeTab()
  if (t?.src.kind === 'ws') return ws.dirOf(t.src.name)
  return (await ws.folders())[0]?.dir ?? ws.UNSORTED
}

let treeBusy = false
let treeAgain = false
async function refreshTree() {
  // the list is read again on every change from another tab: one at a time
  if (treeBusy) return void (treeAgain = true)
  treeBusy = true
  try {
    await drawTree()
  } finally {
    treeBusy = false
    if (treeAgain) {
      treeAgain = false
      void refreshTree()
    }
  }
}

async function drawTree() {
  const all = await ws.folders()
  void updateStorage(all)
  const ul = $('wstree')
  ul.replaceChildren()
  if (!all.length) {
    ul.innerHTML = '<li class="empty">Empty. A folder appears here for each model XPP runs, or use ⋯ → New model / Add files.</li>'
    return
  }
  const cur = activeTab()
  const curDir = cur?.src.kind === 'ws' ? ws.dirOf(cur.src.name) : ''
  all.forEach((g, i) => {
    const open = folderOpen[g.dir] ?? (i === 0 || g.dir === curDir)
    const li = document.createElement('li')
    li.className = 'dir'
    li.dataset.dir = g.dir
    li.innerHTML = `<span class="ic"></span><span class="nm"></span><span class="when"></span><button type="button" class="more" aria-label="More">⋯</button>`
    li.querySelector('.ic')!.textContent = open ? '▾' : '▸'
    li.querySelector('.nm')!.textContent = g.dir
    const bytes = g.files.reduce((n, f) => n + f.size, 0)
    li.querySelector('.when')!.textContent = `${sizeText(bytes)} · ${ago(g.opened)}`
    li.title = `${g.dir}: ${g.files.length} file${g.files.length === 1 ? '' : 's'}, ${sizeText(bytes)}, opened ${new Date(g.opened).toLocaleString()}`
    li.setAttribute('aria-expanded', String(open))
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('more')) return folderMenu(e as MouseEvent, g.dir, g.files.map((f) => f.name))
      folderOpen[g.dir] = !open
      keepFolderOpen()
      void refreshTree()
    })
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      folderMenu(e, g.dir, g.files.map((f) => f.name))
    })
    // a file dropped on a folder moves there
    li.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('text/x-xpp')) return
      e.preventDefault()
      li.classList.add('drop')
    })
    li.addEventListener('dragleave', () => li.classList.remove('drop'))
    li.addEventListener('drop', (e) => {
      e.preventDefault()
      li.classList.remove('drop')
      const d = e.dataTransfer?.getData('text/x-xpp') ?? ''
      if (d.startsWith('ws|')) void moveFile(d.slice(3), g.dir)
    })
    ul.append(li)
    if (!open) return
    // the model first, then the rest by name
    const files = g.files.filter((f) => !/^fort\.\d+$/.test(ws.baseOf(f.name)))
    files.sort((a, b) => Number(/\.ode$/i.test(b.name)) - Number(/\.ode$/i.test(a.name)) || a.name.localeCompare(b.name))
    if (!files.length) {
      const e = document.createElement('li')
      e.className = 'empty sub'
      e.textContent = 'No files yet'
      ul.append(e)
    }
    for (const f of files) {
      const base = ws.baseOf(f.name)
      const fi = document.createElement('li')
      fi.className = 'sub'
      fi.draggable = true
      fi.dataset.key = 'ws:' + f.name
      fi.innerHTML = `<span class="ic"></span><span class="nm"></span><button type="button" class="more" aria-label="More">⋯</button>`
      fi.querySelector('.ic')!.textContent = icon(base)
      fi.querySelector('.nm')!.textContent = base
      fi.title = `${f.name} · ${(f.size / 1024).toFixed(1)} kB · ${new Date(f.mtime).toLocaleString()}`
      if (cur && srcKey(cur.src) === fi.dataset.key) fi.classList.add('active')
      fi.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('more')) return fileMenu(e as MouseEvent, f.name)
        void openFile({ kind: 'ws', name: f.name })
        if (touchy()) closeSide()
      })
      fi.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        fileMenu(e, f.name)
      })
      fi.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-xpp', 'ws|' + f.name))
      ul.append(fi)
    }
  })
}

function menu(e: MouseEvent, items: Array<[string, () => void] | null>) {
  document.querySelector('.menu')?.remove()
  const m = document.createElement('div')
  m.className = 'menu'
  for (const it of items) {
    if (!it) {
      m.append(document.createElement('hr'))
      continue
    }
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = it[0]
    b.addEventListener('click', () => {
      m.remove()
      it[1]()
    })
    m.append(b)
  }
  document.body.append(m)
  const r = m.getBoundingClientRect()
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px'
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px'
  setTimeout(() => document.addEventListener('pointerdown', (ev) => !m.contains(ev.target as Node) && m.remove(), { once: true }), 0)
}

function fileMenu(e: MouseEvent, name: string) {
  const items: Array<[string, () => void] | null> = [
    ['Open', () => void openFile({ kind: 'ws', name })],
    ...(touchy() ? [] : [['Open to the side', () => (groups.length < 2 ? (groups.push(makeGroup()), layoutGroups()) : 0, void openFile({ kind: 'ws', name }, 1))] as [string, () => void]]),
    ...(kindOf(name) !== 'text' ? [['Open as text', () => void openFile({ kind: 'ws', name }, focused, true)] as [string, () => void]] : []),
    ['Open in new window', () => newWindow(name)],
    null,
    ['Rename…', () => void renameFile(name)],
    ['Duplicate', () => void duplicateFile(name)],
    ['Move to folder…', () => void moveFilePrompt(name)],
    ['Download', async () => {
      const d = await ws.read(name)
      if (d) download(ws.baseOf(name), d)
    }],
    null,
    ['Delete', () => void deleteFile(name)],
  ]
  menu(e, items)
}

function folderMenu(e: MouseEvent, dir: string, files: string[]) {
  const model = files.find((n) => ws.folderFor(ws.baseOf(n)) === dir) ?? files.find((n) => /\.ode$/i.test(n))
  menu(e, [
    ...(model ? [[`Run ${ws.baseOf(model)} in XPP`, () => void openFile({ kind: 'ws', name: model }).then(() => run())] as [string, () => void], null] : []),
    ['New file here…', () => void newFile(dir)],
    ['Add files here…', () => {
      addTarget = dir
      $('upinput').click()
    }],
    null,
    ['Rename folder…', () => void renameDir(dir)],
    ['Download folder (.zip)', () => void downloadDir(dir)],
    null,
    ['Delete folder…', () => void deleteDir(dir)],
  ])
}

const validName = (n: string) => n.trim().replace(/[\\/]/g, '_')
/** the folder for files added by Add files (null: decided by the files) */
let addTarget: string | null = null

async function exists(path: string) {
  return (await ws.list()).some((f) => f.name === path)
}

async function newFile(dir?: string) {
  const n = prompt(dir ? `New file in ${dir} (for example run.xps):` : 'New model or file (a new model.ode gets its own folder):', dir ? 'run.xps' : 'model.ode')
  if (!n) return
  const name = validName(n)
  const where = dir ?? (/\.ode$/i.test(name) ? ws.folderFor(name) : await currentDir())
  const path = ws.join(where, name)
  if (await exists(path)) return toast(`${name} already exists in ${where}`)
  const starter = name.endsWith('.ode')
    ? '# a new model\npar a=1\nx\'=-a*x\ninit x=1\n@ total=20\ndone\n'
    : name.endsWith('.xps')
      ? '# a script: one command per line (File -> Do script in XPP)\nkeys i g\n'
      : ''
  await ws.write(path, ws.bytesOf(starter))
  await ws.touch(where)
  folderOpen[where] = true
  keepFolderOpen()
  await refreshTree()
  void openFile({ kind: 'ws', name: path })
}

/** files the user added (or a restored .zip without folders): a model takes the others into its folder */
async function addFiles(files: Array<{ name: string; data: Uint8Array }>, target: string | null) {
  const ode = files.find((f) => /\.ode$/i.test(f.name))
  const dir = target ?? (ode ? ws.folderFor(ode.name) : await currentDir())
  for (const f of files) await ws.write(ws.join(dir, validName(f.name)), f.data)
  await ws.touch(dir)
  folderOpen[dir] = true
  keepFolderOpen()
  await refreshTree()
  toast(`${files.length} file${files.length === 1 ? '' : 's'} added to ${dir}`)
}

async function renameFile(name: string) {
  const dir = ws.dirOf(name)
  const n = prompt('Rename to:', ws.baseOf(name))
  if (!n || n === ws.baseOf(name)) return
  const to = ws.join(dir, validName(n))
  if (await exists(to)) return toast(`${validName(n)} already exists in ${dir}`)
  await relocate(name, to)
}

/** a file moves (rename, other folder): open tabs follow it */
async function relocate(name: string, to: string) {
  const d = await ws.read(name)
  if (!d) return
  await ws.write(to, d)
  await ws.remove(name)
  let reopen = false
  for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws' && t.src.name === name) {
    if (t.dirty) await saveTab(t)
    await closeTab(t)
    reopen = true
  }
  await refreshTree()
  if (reopen) void openFile({ kind: 'ws', name: to })
}

async function moveFile(name: string, dir: string) {
  if (ws.dirOf(name) === dir) return
  const to = ws.join(dir, ws.baseOf(name))
  if (await exists(to)) return toast(`${ws.baseOf(name)} already exists in ${dir}`)
  await relocate(name, to)
  toast(`${ws.baseOf(name)} moved to ${dir}`)
}

async function moveFilePrompt(name: string) {
  const dirs = (await ws.folders()).map((g) => g.dir).filter((d) => d !== ws.dirOf(name))
  const n = prompt(`Move ${ws.baseOf(name)} to which folder? (a new name makes a new folder)\n${dirs.join(', ')}`, dirs[0] ?? '')
  if (n) await moveFile(name, validName(n))
}

async function duplicateFile(name: string) {
  const d = await ws.read(name)
  if (!d) return
  const dir = ws.dirOf(name)
  const base = ws.baseOf(name)
  const dot = base.lastIndexOf('.')
  const make = (k: string) => ws.join(dir, dot > 0 ? `${base.slice(0, dot)}-copy${k}${base.slice(dot)}` : `${base}-copy${k}`)
  let to = make('')
  for (let k = 2; await exists(to); k++) to = make(String(k))
  await ws.write(to, d)
  await refreshTree()
}

async function deleteFile(name: string) {
  if (!confirm(`Delete ${ws.baseOf(name)} from ${ws.dirOf(name)} (in this browser, and XPP's folder)?`)) return
  for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws' && t.src.name === name) {
    t.dirty = false
    await closeTab(t)
  }
  await ws.remove(name)
  await refreshTree()
}

async function renameDir(dir: string) {
  const n = prompt('Rename the folder to:', dir)
  if (!n || validName(n) === dir) return
  const to = validName(n)
  if ((await ws.folders()).some((g) => g.dir === to)) return toast(`There is already a folder ${to}`)
  const open = groups.flatMap((g) => g.tabs).filter((t) => t.src.kind === 'ws' && ws.dirOf(t.src.name) === dir)
  for (const t of open) if (t.dirty) await saveTab(t)
  await ws.renameFolder(dir, to)
  for (const t of open) {
    const name = (t.src as { name: string }).name
    await closeTab(t)
    void openFile({ kind: 'ws', name: ws.join(to, ws.baseOf(name)) })
  }
  folderOpen[to] = folderOpen[dir] ?? true
  delete folderOpen[dir]
  keepFolderOpen()
  await refreshTree()
}

async function deleteDir(dir: string) {
  if (!confirm(`Delete the folder ${dir} and every file in it (in this browser)? Download folder first to keep a copy.`)) return
  for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws' && ws.dirOf(t.src.name) === dir) {
    t.dirty = false
    await closeTab(t)
  }
  await ws.removeFolder(dir)
  delete folderOpen[dir]
  keepFolderOpen()
  await refreshTree()
}

async function downloadDir(dir: string) {
  const files = (await ws.readAll()).filter((f) => ws.dirOf(f.name) === dir && !/^fort\.\d+$/.test(ws.baseOf(f.name))).map((f) => ({ name: ws.baseOf(f.name), data: f.data }))
  if (!files.length) return toast(`${dir} is empty`)
  download(dir + '.zip', makeZip(files))
}

async function downloadAll() {
  // one folder per model, as here
  const files = (await ws.readAll()).filter((f) => !/^fort\.\d+$/.test(ws.baseOf(f.name))).map((f) => ({ name: f.name, data: f.data }))
  if (!files.length) return toast('Nothing is kept in this browser yet')
  download('xpp-workspace.zip', makeZip(files))
}

async function restoreZip(file: File) {
  try {
    const files = await unzip(new Uint8Array(await file.arrayBuffer()))
    const loose: Array<{ name: string; data: Uint8Array }> = []
    let n = 0
    for (const f of files) {
      const parts = f.name.split('/').filter(Boolean)
      if (!parts.length) continue
      // "folder/name" (Download all): back into its folder; loose files: by their model
      if (parts.length >= 2) {
        await ws.write(ws.join(validName(parts[0]), validName(parts[parts.length - 1])), f.data)
        n++
      } else loose.push({ name: parts[0], data: f.data })
    }
    if (loose.length) {
      const dirs = [...new Set([...(await ws.folders()).map((g) => g.dir), ...loose.filter((f) => /\.ode$/i.test(f.name)).map((f) => ws.folderFor(f.name))])]
      for (const f of loose) await ws.write(ws.join(ws.guessDir(f.name, dirs), validName(f.name)), f.data)
    }
    await refreshTree()
    toast(`Restored ${n + loose.length} files`)
  } catch (e) {
    toast('Could not read the .zip: ' + (e as Error).message, 5000)
  }
}

// ---- Local files: a folder on this device ----------------------------------------
// Chrome and Edge open the folder itself (edits are saved in place, the folder
// is remembered). Other browsers can only read a copy of it: the copy is kept
// here, and Save downloads the file.
type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]>; requestPermission?(o: object): Promise<string>; queryPermission?(o: object): Promise<string> }
let folder: DirHandle | null = null
/** the remembered folder, when the browser wants a click before opening it again */
let pendingHandle: DirHandle | null = null
const canFolder = 'showDirectoryPicker' in window
let localCopy: { name: string; when: number; files: Map<string, Uint8Array> } | null = null

function chooseLocal() {
  setView('local')
  if (canFolder) void openFolder()
  else $('dirinput').click()
}

async function openFolder(h?: DirHandle, show = true) {
  try {
    const dir = h ?? ((await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' })) as DirHandle)
    if (h && h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return
    folder = dir
    pendingHandle = null
    keepHandle(dir)
    if (show) setView('local')
    else void renderLocal()
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('Could not open the folder: ' + (e as Error).message, 5000)
  }
}

async function listDir(dir: DirHandle, path: string, depth: number, out: Array<{ path: string; handle: FileSystemHandle | null; depth: number }>) {
  const items: Array<[string, FileSystemHandle]> = []
  for await (const e of dir.entries()) items.push(e)
  items.sort((a, b) => (a[1].kind === b[1].kind ? a[0].localeCompare(b[0]) : a[1].kind === 'directory' ? -1 : 1))
  for (const [name, handle] of items) {
    if (name.startsWith('.')) continue
    out.push({ path: path + name, handle, depth })
    if (handle.kind === 'directory' && depth < 2) await listDir(handle as DirHandle, path + name + '/', depth + 1, out)
  }
}

/** the copy's files as a tree (folders first) */
function copyItems(): Array<{ path: string; handle: null; depth: number; dir: boolean }> {
  if (!localCopy) return []
  const dirs = new Set<string>()
  for (const p of localCopy.files.keys()) {
    const parts = p.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  const all = [...[...dirs].map((p) => ({ p, dir: true })), ...[...localCopy.files.keys()].map((p) => ({ p, dir: false }))]
  // sort as a tree: by path, a folder before what is inside it, folders before files at each level
  const key = (x: { p: string; dir: boolean }) => x.p.split('/').map((s, i, a) => (i < a.length - 1 || x.dir ? '0' : '1') + s).join('/')
  all.sort((a, b) => key(a).localeCompare(key(b)))
  return all.map((x) => ({ path: x.p, handle: null, depth: x.p.split('/').length - 1, dir: x.dir }))
}

async function renderLocal() {
  const ul = $('foldertree')
  ul.replaceChildren()
  const name = folder?.name ?? localCopy?.name
  $('foldername').textContent = name ? (localCopy && !folder ? `${name} (a copy)` : name) : 'No folder'
  if (!folder && !localCopy) {
    // empty: choose one (the system's folder picker)
    const li = document.createElement('li')
    li.className = 'choose'
    li.innerHTML = `<p>No folder yet. Choose a folder on this device: its files appear here${canFolder ? ', and Save writes into it' : ' (this browser reads a copy; Save downloads the file)'}. The folder is remembered.</p>`
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'big'
    b.textContent = 'Choose a folder…'
    b.addEventListener('click', chooseLocal)
    li.append(b)
    if (pendingHandle) {
      const r = document.createElement('button')
      r.type = 'button'
      r.className = 'big'
      r.textContent = 'Reopen ' + pendingHandle.name
      r.title = 'Open the folder you used last time (the browser asks for permission)'
      r.addEventListener('click', () => void openFolder(pendingHandle!))
      li.prepend(r)
    }
    ul.append(li)
    return
  }
  const items: Array<{ path: string; handle: FileSystemHandle | null; depth: number; dir?: boolean }> = []
  if (folder) {
    try {
      await listDir(folder, '', 0, items)
    } catch (e) {
      ul.innerHTML = '<li class="empty"></li>'
      ul.querySelector('li')!.textContent = 'Cannot read the folder: ' + (e as Error).message
      return
    }
  } else items.push(...copyItems())
  if (!items.length) ul.innerHTML = '<li class="empty">The folder is empty</li>'
  for (const it of items) {
    const li = document.createElement('li')
    li.style.paddingLeft = 8 + it.depth * 14 + 'px'
    const name = it.path.split('/').pop()!
    li.innerHTML = `<span class="ic"></span><span class="nm"></span>`
    li.querySelector('.nm')!.textContent = name
    const isDir = it.handle ? it.handle.kind === 'directory' : !!it.dir
    if (isDir) {
      li.classList.add('dir')
      li.querySelector('.ic')!.textContent = '▾'
    } else {
      const src: Source = it.handle ? { kind: 'folder', path: it.path, handle: it.handle as FileSystemFileHandle } : { kind: 'copy', path: it.path }
      li.dataset.key = srcKey(src)
      if (activeTab() && srcKey(activeTab()!.src) === li.dataset.key) li.classList.add('active')
      li.querySelector('.ic')!.textContent = icon(name)
      li.addEventListener('click', () => {
        void openFile(src)
        if (touchy()) closeSide()
      })
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        menu(e, [
          ['Open', () => void openFile(src)],
          ['Copy to Web files', async () => {
            const path = await localToWs(src, false)
            if (path) toast(`${name} copied to ${ws.dirOf(path)}`)
          }],
        ])
      })
    }
    ul.append(li)
  }
}

/** the files beside a local file (same folder) */
async function localSiblings(src: Source): Promise<Array<{ name: string; data: Uint8Array }>> {
  const out: Array<{ name: string; data: Uint8Array }> = []
  if (src.kind === 'copy' && localCopy) {
    const parent = src.path.includes('/') ? src.path.slice(0, src.path.lastIndexOf('/') + 1) : ''
    for (const [p, d] of localCopy.files) if (p.startsWith(parent) && !p.slice(parent.length).includes('/') && d.length <= 5_000_000) out.push({ name: p.slice(parent.length), data: d })
  } else if (src.kind === 'folder' && folder) {
    let dir: DirHandle = folder
    for (const p of src.path.split('/').slice(0, -1)) dir = (await dir.getDirectoryHandle(p)) as DirHandle
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file' || name.startsWith('.')) continue
      const f = await (h as FileSystemFileHandle).getFile()
      if (f.size > 5_000_000) continue
      out.push({ name, data: new Uint8Array(await f.arrayBuffer()) })
    }
  }
  return out
}

/** a local file into Web files (for Run): with `all`, the files beside it come too,
 *  into the folder of their model; returns its path here */
async function localToWs(src: Source, all = true): Promise<string | null> {
  if (src.kind === 'ws') return src.name
  const name = src.path.split('/').pop()!
  try {
    const sib = await localSiblings(src)
    const parentName = src.path.includes('/') ? src.path.split('/').slice(-2, -1)[0] : (folder?.name ?? localCopy?.name ?? 'local')
    const ode = /\.ode$/i.test(name) ? name : sib.find((f) => /\.ode$/i.test(f.name))?.name
    const dir = ode ? ws.folderFor(ode) : validName(parentName)
    const files = all ? sib : sib.filter((f) => f.name === name)
    if (!files.some((f) => f.name === name)) {
      const d = await readSource(src)
      if (d) files.push({ name, data: d })
    }
    for (const f of files) await ws.write(ws.join(dir, f.name), f.data, true)
    ws.post({ t: 'changed', name: ws.join(dir, name) })
    await ws.touch(dir)
    await refreshTree()
    return ws.join(dir, name)
  } catch (e) {
    toast('Could not copy from the folder: ' + (e as Error).message, 5000)
    return null
  }
}

// other browsers: the folder chosen with the file picker, read into a copy
async function readCopy(list: File[]) {
  const files = new Map<string, Uint8Array>()
  let total = 0
  let top = ''
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
    const parts = rel.split('/')
    if (parts.length > 1) top ||= parts[0]
    const path = parts.length > 1 ? parts.slice(1).join('/') : rel
    if (path.split('/').some((p) => p.startsWith('.')) || f.size > 20_000_000 || total + f.size > 100_000_000) continue
    total += f.size
    files.set(path, new Uint8Array(await f.arrayBuffer()))
  }
  localCopy = { name: top || 'Chosen files', when: Date.now(), files }
  void keepCopy(localCopy)
  setView('local')
  toast(`Read ${files.size} files from ${localCopy.name}`)
}

// remembered: the folder (Chrome, Edge: the browser asks again for permission)
// or the copy (other browsers)
function kv<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return new Promise((ok) => {
    const r = indexedDB.open('xpp-editor', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => {
      try {
        const q = f(r.result.transaction('kv', mode).objectStore('kv'))
        if (!q) return ok(null)
        q.onsuccess = () => ok((q.result as T) ?? null)
        q.onerror = () => ok(null)
      } catch {
        ok(null)
      }
    }
    r.onerror = () => ok(null)
  })
}
function keepHandle(h: DirHandle) {
  void kv('readwrite', (s) => void s.put(h, 'folder'))
}
function keepCopy(c: { name: string; when: number; files: Map<string, Uint8Array> }) {
  return kv('readwrite', (s) => void s.put({ name: c.name, when: c.when, files: [...c.files] }, 'copy'))
}
function forgetLocal() {
  void kv('readwrite', (s) => {
    s.delete('folder')
    s.delete('copy')
  })
  folder = null
  pendingHandle = null
  localCopy = null
  void renderLocal()
}
const lastHandle = () => kv<DirHandle>('readonly', (s) => s.get('folder') as IDBRequest<DirHandle>)
const lastCopy = () => kv<{ name: string; when: number; files: Array<[string, Uint8Array]> }>('readonly', (s) => s.get('copy') as IDBRequest<{ name: string; when: number; files: Array<[string, Uint8Array]> }>)

// ---- problems panel, status, title buttons ---------------------------------------
function updateChrome() {
  const t = activeTab()
  $('st-file').textContent = t ? (t.src.kind === 'ws' ? t.src.name : (t.src.kind === 'folder' ? 'local: ' : 'local copy: ') + t.src.path) + (t.dirty ? ' ●' : '') : ''
  $('st-lang').textContent = t ? ({ ode: 'XPP model', xps: 'XPP script', plain: t.kind === 'text' || t.asText ? 'Text' : t.kind.toUpperCase() } as const)[languageOf(t.title)] : ''
  const lang = t ? languageOf(t.title) : 'plain'
  $<HTMLButtonElement>('runbtn').disabled = !(lang === 'ode' || lang === 'xps')
  $<HTMLButtonElement>('runbtn').textContent = lang === 'xps' ? '▶ Run script' : '▶ Run in XPP'
  $<HTMLButtonElement>('savebtn').disabled = !t?.view
  $<HTMLButtonElement>('splitbtn').textContent = groups.length > 1 ? 'Unsplit' : 'Split'
  const marks = t?.marks ?? []
  const ne = marks.filter((m) => m.severity === 'error').length
  $('st-problems').textContent = `⨂ ${ne} ⚠ ${marks.length - ne}`
  const ul = $('problems')
  ul.replaceChildren()
  for (const m of marks) {
    const li = document.createElement('li')
    li.className = 'sev-' + m.severity
    li.innerHTML = `<span class="msg"></span> <span class="where"></span>`
    li.querySelector('.msg')!.textContent = m.message
    li.querySelector('.where')!.textContent = m.line >= 0 ? `line ${m.line + 1}` : ''
    li.addEventListener('click', () => m.line >= 0 && t?.view?.reveal(m.line))
    ul.append(li)
  }
  if (!marks.length) ul.innerHTML = '<li class="where">No problems in this file.</li>'
  const key = t ? srcKey(t.src) : ''
  for (const li of document.querySelectorAll<HTMLElement>('#wstree li[data-key], #foldertree li[data-key]')) li.classList.toggle('active', li.dataset.key === key)
}

function settingsPop() {
  const old = document.querySelector('.settings-pop')
  if (old) return old.remove()
  const p = document.createElement('div')
  p.className = 'settings-pop'
  p.innerHTML = `<h3>Editor settings</h3>
    <label for="s-theme">Theme</label><select id="s-theme"><option value="site">Follow the site’s theme</option>${THEMES.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
    <label for="s-style">Editor</label><select id="s-style"><option value="auto">Automatic</option><option value="monaco">VS Code style (computers)</option><option value="codemirror">Touch style (phones, tablets)</option></select>
    <label for="s-font">Font size</label><input type="number" id="s-font" min="9" max="28">
    <label for="s-wrap">Wrap long lines</label><input type="checkbox" id="s-wrap">
    <label for="s-mini">Minimap</label><input type="checkbox" id="s-mini">
    <label for="s-auto">Save automatically</label><input type="checkbox" id="s-auto">
    ${canFolder ? '<label for="s-reopen">Open my folder every time</label><input type="checkbox" id="s-reopen">' : ''}
    <span></span><button type="button" id="s-forget">Forget my local folder</button>
    <p>Web files are kept in this browser, one folder per model, and shared with XPP's tab. Clearing the site's data deletes them: Download all (⋯ in Web files) keeps a copy.</p>`
  document.body.append(p)
  const sel = (id: string) => p.querySelector<HTMLInputElement & HTMLSelectElement>('#' + id)!
  sel('s-theme').value = settings.theme
  sel('s-style').value = settings.style
  sel('s-font').value = String(settings.fontSize)
  sel('s-wrap').checked = settings.wrap
  sel('s-mini').checked = settings.minimap
  sel('s-auto').checked = settings.autosave
  if (canFolder) sel('s-reopen').checked = settings.reopenFolder
  p.querySelector('#s-forget')!.addEventListener('click', () => {
    forgetLocal()
    toast('The local folder is forgotten')
  })
  p.addEventListener('change', async () => {
    const styleBefore = engineKind()
    settings.theme = sel('s-theme').value
    settings.style = sel('s-style').value as Style
    settings.fontSize = Math.max(9, Math.min(28, Number(sel('s-font').value) || 14))
    settings.wrap = sel('s-wrap').checked
    settings.minimap = sel('s-mini').checked
    settings.autosave = sel('s-auto').checked
    if (canFolder) settings.reopenFolder = sel('s-reopen').checked
    saveSettings()
    applyTheme()
    engine?.setOptions(engineOpts())
    if (engineKind() !== styleBefore) {
      // the other editor: reopen the text tabs in it (their text is saved first)
      for (const g of groups) for (const t of g.tabs) if (t.view) {
        await saveTab(t)
        await reloadTabFresh(t)
      }
    }
  })
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) {
    if (!p.contains(ev.target as Node) && ev.target !== $('setbtn')) {
      p.remove()
      document.removeEventListener('pointerdown', off)
    }
  }), 0)
}

async function reloadTabFresh(t: Tab) {
  const d = await readSource(t.src)
  if (d) await fillTab(t, d)
  t.view?.layout()
}

// ---- splitters ----------------------------------------------------------------
function dragSplit(el: HTMLElement, axis: 'x' | 'y', move: (d: number, start: number) => void, start: () => number) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    el.classList.add('drag')
    const s = start()
    const p0 = axis === 'x' ? e.clientX : e.clientY
    const mv = (ev: PointerEvent) => move((axis === 'x' ? ev.clientX : ev.clientY) - p0, s)
    const up = () => {
      el.classList.remove('drag')
      el.removeEventListener('pointermove', mv)
      el.removeEventListener('pointerup', up)
      for (const g of groups) for (const t of g.tabs) t.view?.layout()
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up)
  })
}
dragSplit($('sidesplit'), 'x', (d, s) => document.documentElement.style.setProperty('--side-w', Math.max(140, Math.min(560, s + d)) + 'px'), () => $('side').clientWidth)
dragSplit($('panelsplit'), 'y', (d, s) => document.documentElement.style.setProperty('--panel-h', Math.max(60, Math.min(innerHeight - 200, s - d)) + 'px'), () => $('panelwrap').querySelector<HTMLElement>('.ed-panel')!.clientHeight)

// ---- the bottom panel: terminal, problems, sliders; XPP's command bar ------
function showPanel(which: 'terminal' | 'problems' | 'sliders') {
  $('panelwrap').classList.remove('closed')
  for (const b of document.querySelectorAll<HTMLElement>('.ptabs [data-p]')) b.classList.toggle('on', b.dataset.p === which)
  for (const b of document.querySelectorAll<HTMLElement>('.pbody')) b.hidden = b.dataset.p !== which
  for (const b of document.querySelectorAll<HTMLElement>('.ptools')) b.hidden = b.dataset.for !== which
  if (which === 'sliders') ws.post({ t: 'params-req' })
  if (which === 'terminal') scrollTerm()
  for (const g of groups) for (const t of g.tabs) t.view?.layout()
}
for (const b of document.querySelectorAll<HTMLElement>('.ptabs [data-p]')) b.addEventListener('click', () => showPanel(b.dataset.p as 'terminal'))

// the terminal: XPP's output, sent by XPP's tab
const MAXLINES = 5000
const termLines: string[] = []
const scrollTerm = () => {
  const pre = $('term')
  pre.parentElement!.scrollTop = pre.parentElement!.scrollHeight
}
function termWrite(lines: string[]) {
  const pre = $('term')
  const body = pre.parentElement!
  const atEnd = body.scrollTop + body.clientHeight >= body.scrollHeight - 30
  termLines.push(...lines)
  if (termLines.length > MAXLINES) termLines.splice(0, termLines.length - MAXLINES)
  pre.textContent = termLines.join('\n')
  if (atEnd) scrollTerm()
}
$('termclear').addEventListener('click', () => {
  termLines.length = 0
  $('term').textContent = ''
})
$('termcopy').addEventListener('click', () => void navigator.clipboard?.writeText(termLines.join('\n')).then(() => toast('Copied')))
$('termsave').addEventListener('click', async () => {
  const name = 'xpp-output-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt'
  await ws.write(name, ws.bytesOf(termLines.join('\n') + '\n'))
  await refreshTree()
  toast('Saved ' + name)
})

// XPP's command bar: "Label = keys" lines (as the phone's Cmd panel), kept per browser
const CMD_KEY = 'xpp-editor-cmds'
const CMD_DEFAULT = [
  'Integrate = i g', 'Last = i l', 'Continue = c', 'Nullclines = n n', 'Dir. field = d d', 'Erase = e',
  'Fit = w f', 'Restore = r', 'Sing pts = s g', 'AUTO = f a', 'Do script = f d', 'Esc = Esc', 'Enter = Enter',
].join('\n')
const CMD_HELP = `# XPP's command bar, one button per line:   Label = keys
# keys are XPP's menu letters:  Fit = w f   (Window/zoom, then Fit)
# for AUTO's window, start the keys with "auto:"   Steady state = auto: r s
# named keys: Esc Enter Tab Left Right Up Down`
const cmdText = () => {
  try {
    return localStorage.getItem(CMD_KEY) ?? CMD_DEFAULT
  } catch {
    return CMD_DEFAULT
  }
}
function parseCmds(text: string) {
  const out: Array<{ label: string; keys: string[]; to?: 'auto' }> = []
  for (const line of text.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const i = l.indexOf('=')
    if (i < 1) continue
    let rest = l.slice(i + 1).trim()
    const auto = /^auto:/i.test(rest)
    if (auto) rest = rest.slice(5).trim()
    const keys = parseKeys(rest)
    if (keys.length) out.push({ label: l.slice(0, i).trim(), keys, to: auto ? 'auto' : undefined })
  }
  return out
}
function renderCmdBar() {
  const bar = $('cmdbar')
  bar.replaceChildren()
  for (const c of parseCmds(cmdText())) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = c.label
    b.title = (c.to === 'auto' ? 'AUTO: ' : '') + c.keys.join(' ')
    b.addEventListener('click', () => {
      if (!xppAlive()) return toast('Open XPP first (the XPP button), then use its commands here')
      ws.post({ t: 'cmd', keys: c.keys, to: c.to })
    })
    bar.append(b)
  }
  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'cmdedit'
  edit.textContent = '✎'
  edit.title = 'Edit these buttons'
  edit.addEventListener('click', editCmds)
  bar.append(edit)
}
function editCmds() {
  document.querySelector('.cmd-dialog')?.remove()
  const d = document.createElement('div')
  d.className = 'settings-pop cmd-dialog'
  d.innerHTML = `<h3>XPP's command bar</h3><textarea rows="14" spellcheck="false"></textarea>
    <p>Kept in this browser. Changes show as soon as you save.</p>
    <button type="button" data-a="reset">Default</button><span></span><button type="button" data-a="cancel">Cancel</button><button type="button" data-a="save" class="run">Save</button>`
  const ta = d.querySelector('textarea')!
  ta.value = CMD_HELP + '\n' + cmdText()
  d.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).dataset.a
    if (a === 'reset') ta.value = CMD_HELP + '\n' + CMD_DEFAULT
    if (a === 'cancel') d.remove()
    if (a === 'save') {
      const body = ta.value.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').trim()
      if (!parseCmds(body).length) return toast('No commands: write lines like  Integrate = i g')
      try {
        localStorage.setItem(CMD_KEY, body)
      } catch {
        /* private mode */
      }
      renderCmdBar()
      d.remove()
    }
  })
  document.body.append(d)
  ta.focus()
}

// the sliders: XPP's own three Par/Var sliders (XPP re-runs as one moves)
let params: Array<{ name: string; value: number; ic: boolean }> = []
const sliderRows: Array<{ sel: HTMLSelectElement; lo: HTMLInputElement; hi: HTMLInputElement; range: HTMLInputElement; out: HTMLOutputElement; ready: boolean }> = []
function buildSliders() {
  const box = $('sliders')
  box.innerHTML = '<p class="hint">Pick a parameter or initial value: XPP runs the model again as you drag (XPP’s three Par/Var sliders).</p>'
  for (let k = 0; k < 3; k++) {
    const row = document.createElement('div')
    row.className = 'srow'
    row.innerHTML = `<select aria-label="Parameter"></select><input type="number" class="lo" step="any" aria-label="Low"><input type="range" min="0" max="1000" step="1" aria-label="Value"><input type="number" class="hi" step="any" aria-label="High"><output></output>`
    const r = { sel: row.querySelector('select')!, lo: row.querySelector<HTMLInputElement>('.lo')!, hi: row.querySelector<HTMLInputElement>('.hi')!, range: row.querySelector<HTMLInputElement>('input[type=range]')!, out: row.querySelector('output')!, ready: false }
    const setup = (v: number) => {
      if (!r.sel.value) return
      r.ready = false
      ws.post({ t: 'slider-setup', k, name: r.sel.value, lo: +r.lo.value, hi: +r.hi.value, value: v })
    }
    r.sel.addEventListener('change', () => {
      const p = params.find((q) => q.name === r.sel.value)
      if (!p) return
      const span = p.value === 0 ? 1 : Math.abs(p.value)
      r.lo.value = String(+(p.value - span).toPrecision(6))
      r.hi.value = String(+(p.value + span).toPrecision(6))
      r.range.value = '500'
      r.out.textContent = String(+p.value.toPrecision(6))
      setup(p.value)
    })
    const val = () => +r.lo.value + ((+r.hi.value - +r.lo.value) * +r.range.value) / 1000
    for (const inp of [r.lo, r.hi]) inp.addEventListener('change', () => setup(Math.min(+r.hi.value, Math.max(+r.lo.value, Number(r.out.textContent) || +r.lo.value))))
    r.range.addEventListener('input', () => {
      const v = val()
      r.out.textContent = String(+v.toPrecision(6))
      if (r.ready) ws.post({ t: 'slider-move', k, value: v })
    })
    sliderRows.push(r)
    box.append(row)
  }
}
function fillSliders(list: typeof params, sliders: Array<{ name: string; value: number; lo: number; hi: number } | null>) {
  params = list
  sliderRows.forEach((r, k) => {
    const keep = sliders[k]?.name ?? r.sel.value
    r.sel.innerHTML = '<option value="">(choose)</option>'
    for (const [label, ic] of [['Parameters', false], ['Initial values', true]] as const) {
      const og = document.createElement('optgroup')
      og.label = label
      for (const p of list.filter((q) => q.ic === ic)) og.append(new Option(p.name, p.name))
      r.sel.append(og)
    }
    r.sel.value = keep
    const s = sliders[k]
    if (s) {
      r.lo.value = String(s.lo)
      r.hi.value = String(s.hi)
      r.range.value = String(Math.round(((s.value - s.lo) / (s.hi - s.lo || 1)) * 1000))
      r.out.textContent = String(+s.value.toPrecision(6))
      r.ready = true
    }
  })
}

// the running script line: an arrow in the editor
let runLine: { name: string; line: number } = { name: '', line: 0 }
function applyRunLine(t: Tab) {
  if (!t.view) return
  // XPP names the script "folder/x.xps"; a local file is matched by its name
  const mine = t.src.kind === 'ws' ? t.src.name === runLine.name : t.title === ws.baseOf(runLine.name)
  t.view.setRunLine(runLine.line && mine ? runLine.line - 1 : null)
}

/** another editor window: they all share the workspace (and update each other) */
function newWindow(name?: string) {
  const w = window.open('editor.html' + (name ? '#' + encodeURIComponent(name) : ''), '_blank', touchy() ? '' : 'popup,width=1100,height=750')
  if (!w) toast('Allow pop-ups for this site to open new windows')
}

// ---- wiring ----------------------------------------------------------------------
const closeSide = () => $('main').classList.remove('side-open')
$('sidebtn').addEventListener('click', () => {
  if (touchy()) $('main').classList.toggle('side-open')
  else $('main').classList.toggle('no-side')
})
$('newbtn').addEventListener('click', () => void newFile())
$('upbtn').addEventListener('click', () => $('upinput').click())
$<HTMLInputElement>('upinput').addEventListener('change', async (e) => {
  const inp = e.target as HTMLInputElement
  const files = await Promise.all([...(inp.files ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })))
  inp.value = ''
  const target = addTarget
  addTarget = null
  if (files.length) await addFiles(files, target)
})
$<HTMLInputElement>('dirinput').addEventListener('change', (e) => {
  const inp = e.target as HTMLInputElement
  if (inp.files?.length) void readCopy([...inp.files]) // (the list empties when the input is reset)
  inp.value = ''
})
for (const b of document.querySelectorAll<HTMLButtonElement>('.sideview button')) b.addEventListener('click', () => setView(b.dataset.v as 'web' | 'local'))
$('localmenu').addEventListener('click', (e) =>
  menu(e, [
    ['Choose another folder…', chooseLocal],
    ...(folder || localCopy ? [['Read it again', () => (folder ? void renderLocal() : $('dirinput').click())] as [string, () => void]] : []),
    null,
    ['Forget this folder', forgetLocal],
  ]),
)
$<HTMLInputElement>('zipinput').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void restoreZip(f)
  ;(e.target as HTMLInputElement).value = ''
})
$('folderbtn').addEventListener('click', chooseLocal)
$('savebtn').addEventListener('click', () => void saveTab(activeTab()))
$('runbtn').addEventListener('click', () => void run())
$('splitbtn').addEventListener('click', split)
$('winbtn').addEventListener('click', () => newWindow())
$('xppbtn').addEventListener('click', () => {
  if (window.opener && !window.opener.closed) window.opener.focus()
  else window.open('index.html', 'xpp-main')
})
$('setbtn').addEventListener('click', settingsPop)
$('wsmenu').addEventListener('click', (e) =>
  menu(e, [
    ['New model…', () => void newFile()],
    ['Add files…', () => $('upinput').click()],
    null,
    ['Download all (.zip)', () => void downloadAll()],
    ['Keep my files (ask the browser not to clear them)', async () => {
      const ok = await navigator.storage?.persist?.().catch(() => false)
      toast(ok ? 'The browser will keep your files' : 'The browser said no (it decides by how often you use the site); Download all keeps a copy', 5000)
      void updateStorage()
    }],
    ['Restore from .zip…', () => $('zipinput').click()],
    null,
    ['Delete everything…', async () => {
      if (!confirm('Delete every folder and file kept in this browser? (Download all first to keep a copy.)')) return
      for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws') {
        t.dirty = false
        await closeTab(t)
      }
      await ws.clear()
      await refreshTree()
    }],
  ]),
)
$('st-problems').addEventListener('click', () => showPanel('problems'))
$('st-store').addEventListener('click', () => {
  setView('web')
  if (touchy()) $('main').classList.add('side-open')
  else $('main').classList.remove('no-side')
})
$('st-terminal').addEventListener('click', () => ($('panelwrap').classList.contains('closed') ? showPanel('terminal') : $('panelwrap').classList.add('closed')))
$('panelclose').addEventListener('click', () => $('panelwrap').classList.add('closed'))
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveTab(activeTab())
  }
})
window.addEventListener('beforeunload', (e) => {
  if (groups.some((g) => g.tabs.some((t) => t.dirty && t.src.kind !== 'ws'))) e.preventDefault()
})
addEventListener('storage', (e) => e.key === 'xpp-theme' && settings.theme === 'site' && applyTheme())
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => settings.theme === 'site' && applyTheme())

// ---- start -----------------------------------------------------------------------
applyTheme()
renderCmdBar()
buildSliders()
groups.push(makeGroup())
layoutGroups()
welcome(groups[0])
$('st-engine').textContent = engineKind() === 'monaco' ? 'VS Code style' : 'Touch style'
updateXpp()
void refreshTree().then(() => {
  const want = decodeURIComponent(location.hash.slice(1))
  if (want) void openFile({ kind: 'ws', name: want })
})
addEventListener('hashchange', () => {
  const want = decodeURIComponent(location.hash.slice(1))
  if (want) void openFile({ kind: 'ws', name: want })
})
setView(store.get('xpp-editor-view') === 'local' ? 'local' : 'web')
// the local folder chosen before
void (async () => {
  if (canFolder) {
    const h = await lastHandle()
    if (!h) return
    // the browser kept the permission ("Allow on every visit"): open it now
    if (settings.reopenFolder && h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') return void openFolder(h, false)
    pendingHandle = h // Local files offers "Reopen …"
  } else {
    const c = await lastCopy()
    if (c) localCopy = { name: c.name, when: c.when, files: new Map(c.files) }
  }
  void renderLocal()
})()
updateChrome()
