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
    <span class="brand"><img src="./icon-192.png" alt="">XPPAUT editor</span>
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
  </header>
  <main class="ed-main" id="main">
    <aside class="ed-side" id="side">
      <h2><span>Workspace</span><button type="button" id="wsmenu" title="More: download all, restore, empty">⋯</button></h2>
      <ul class="tree" id="wstree"></ul>
      <div id="folderpart" hidden>
        <h2><span id="foldername">Folder</span><button type="button" id="folderclose" title="Close the folder">×</button></h2>
        <ul class="tree" id="foldertree"></ul>
      </div>
    </aside>
    <div class="split v" id="sidesplit"></div>
    <div class="groups" id="groups"></div>
  </main>
  <div class="ed-panel-wrap closed" id="panelwrap">
    <div class="split h" id="panelsplit"></div>
    <section class="ed-panel"><h3><span>Problems</span><button type="button" id="panelclose">×</button></h3><ul class="problems" id="problems"></ul></section>
  </div>
  <footer class="ed-status">
    <span id="st-file"></span><span id="st-lang"></span>
    <button type="button" id="st-problems" title="Problems">⨂ 0 ⚠ 0</button>
    <span class="grow"></span>
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
type Source = { kind: 'ws'; name: string } | { kind: 'folder'; path: string; handle: FileSystemFileHandle }
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
const srcKey = (s: Source) => (s.kind === 'ws' ? 'ws:' + s.name : 'fs:' + s.path)
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
    toast('Cannot read ' + (src.kind === 'ws' ? src.name : src.path))
    return null
  }
  const title = src.kind === 'ws' ? src.name : src.path.split('/').pop()!
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
  tabEl.title = src.kind === 'ws' ? 'Workspace: ' + src.name : 'Folder: ' + src.path
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
      if (settings.autosave) scheduleSave(t)
    })
    scheduleCheck(t)
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
    else {
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
let xppHere: { ode: string; at: number } | null = null
ws.onMessage((m) => {
  if (m.t === 'xpp-here') {
    xppHere = { ode: m.ode, at: Date.now() }
    updateXpp()
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
}
setInterval(updateXpp, 3000)

async function run() {
  const t = activeTab()
  if (!t) return
  if (t.dirty) await saveTab(t)
  let name = t.src.kind === 'ws' ? t.src.name : t.title
  if (t.src.kind === 'folder') {
    // a folder's model: it and the files beside it go into the workspace first
    await copyFolderToWs(t.src.path)
    name = t.title
  }
  const lang = languageOf(name)
  if (lang === 'ode') {
    if (xppAlive()) {
      ws.post({ t: 'run-ode', name })
      toast(`Running ${name} in XPP's tab`)
    } else window.open('index.html?ws=' + encodeURIComponent(name), 'xpp-main')
  } else if (lang === 'xps') {
    if (xppAlive()) {
      ws.post({ t: 'run-script', name })
      toast(`Running ${name} in XPP's tab`)
    } else {
      // XPP is not open: start it with a model of the same name, then the script
      const files = await ws.list()
      const model = files.find((f) => f.name.endsWith('.ode') && name.startsWith(f.name.replace(/\.ode$/, '')))
      if (model) window.open(`index.html?ws=${encodeURIComponent(model.name)}&script=${encodeURIComponent(name)}`, 'xpp-main')
      else toast('Open XPP with a model first (XPP button), then Run the script')
    }
  }
}

// ---- the explorer ----------------------------------------------------------------
const icon = (name: string) => {
  const k = kindOf(name)
  if (/\.ode$/i.test(name)) return '∂'
  if (/\.xps$/i.test(name)) return '▶'
  return k === 'image' ? '🖼' : k === 'ps' || k === 'pdf' ? '📄' : k === 'data' ? '📈' : '·'
}

async function refreshTree() {
  const list = await ws.list()
  const ul = $('wstree')
  ul.replaceChildren()
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Empty. XPP\'s files appear here when XPP runs, or use New / Add files.</li>'
    return
  }
  const cur = activeTab()
  for (const f of list) {
    if (/^fort\.\d+$/.test(f.name)) continue
    const li = document.createElement('li')
    li.draggable = true
    li.innerHTML = `<span class="ic"></span><span class="nm"></span><button type="button" class="more" aria-label="More">⋯</button>`
    li.querySelector('.ic')!.textContent = icon(f.name)
    li.querySelector('.nm')!.textContent = f.name
    li.title = `${f.name} · ${(f.size / 1024).toFixed(1)} kB · ${new Date(f.mtime).toLocaleString()}`
    if (cur?.src.kind === 'ws' && cur.src.name === f.name) li.classList.add('active')
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('more')) return fileMenu(e as MouseEvent, f.name)
      void openFile({ kind: 'ws', name: f.name })
    })
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      fileMenu(e, f.name)
    })
    li.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-xpp', 'ws|' + f.name))
    ul.append(li)
  }
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
    ['Download', async () => {
      const d = await ws.read(name)
      if (d) download(name, d)
    }],
    null,
    ['Delete', () => void deleteFile(name)],
  ]
  menu(e, items)
}

const validName = (n: string) => n.trim().replace(/[\\/]/g, '_')

async function newFile() {
  const n = prompt('New file name (for example model.ode or run.xps):', 'untitled.ode')
  if (!n) return
  const name = validName(n)
  if ((await ws.list()).some((f) => f.name === name)) return toast(name + ' already exists')
  const starter = name.endsWith('.ode')
    ? '# a new model\npar a=1\nx\'=-a*x\ninit x=1\n@ total=20\ndone\n'
    : name.endsWith('.xps')
      ? '# a script: one command per line (File -> Do script in XPP)\nkeys i g\n'
      : ''
  await ws.write(name, ws.bytesOf(starter))
  await refreshTree()
  void openFile({ kind: 'ws', name })
}

async function renameFile(name: string) {
  const n = prompt('Rename to:', name)
  if (!n || n === name) return
  const to = validName(n)
  const d = await ws.read(name)
  if (!d) return
  await ws.write(to, d)
  await ws.remove(name)
  for (const g of groups) for (const t of g.tabs) if (t.src.kind === 'ws' && t.src.name === name) await closeTab(t)
  await refreshTree()
  void openFile({ kind: 'ws', name: to })
}

async function duplicateFile(name: string) {
  const d = await ws.read(name)
  if (!d) return
  const dot = name.lastIndexOf('.')
  let to = dot > 0 ? name.slice(0, dot) + '-copy' + name.slice(dot) : name + '-copy'
  for (let k = 2; (await ws.list()).some((f) => f.name === to); k++) to = dot > 0 ? `${name.slice(0, dot)}-copy${k}${name.slice(dot)}` : `${name}-copy${k}`
  await ws.write(to, d)
  await refreshTree()
}

async function deleteFile(name: string) {
  if (!confirm(`Delete ${name} from the workspace (and XPP's folder)?`)) return
  for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws' && t.src.name === name) {
    t.dirty = false
    await closeTab(t)
  }
  await ws.remove(name)
  await refreshTree()
}

async function downloadAll() {
  const files = (await ws.readAll()).filter((f) => !/^fort\.\d+$/.test(f.name)).map((f) => ({ name: f.name, data: f.data }))
  if (!files.length) return toast('The workspace is empty')
  download('xpp-workspace.zip', makeZip(files))
}

async function restoreZip(file: File) {
  try {
    const files = await unzip(new Uint8Array(await file.arrayBuffer()))
    for (const f of files) await ws.write(validName(f.name.split('/').pop()!), f.data)
    await refreshTree()
    toast(`Restored ${files.length} files`)
  } catch (e) {
    toast('Could not read the .zip: ' + (e as Error).message, 5000)
  }
}

// ---- a folder on the computer (Chrome, Edge) --------------------------------------
type DirHandle = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]>; requestPermission?(o: object): Promise<string>; queryPermission?(o: object): Promise<string> }
let folder: DirHandle | null = null
const canFolder = 'showDirectoryPicker' in window

async function openFolder(h?: DirHandle) {
  try {
    const dir = h ?? ((await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' })) as DirHandle)
    if (h && h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return
    folder = dir
    keepHandle(dir)
    $('foldername').textContent = dir.name
    $('folderpart').hidden = false
    await refreshFolder()
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('Could not open the folder: ' + (e as Error).message, 5000)
  }
}

async function listDir(dir: DirHandle, path: string, depth: number, out: Array<{ path: string; handle: FileSystemHandle; depth: number }>) {
  const items: Array<[string, FileSystemHandle]> = []
  for await (const e of dir.entries()) items.push(e)
  items.sort((a, b) => (a[1].kind === b[1].kind ? a[0].localeCompare(b[0]) : a[1].kind === 'directory' ? -1 : 1))
  for (const [name, handle] of items) {
    if (name.startsWith('.')) continue
    out.push({ path: path + name, handle, depth })
    if (handle.kind === 'directory' && depth < 2) await listDir(handle as DirHandle, path + name + '/', depth + 1, out)
  }
}

async function refreshFolder() {
  if (!folder) return
  const ul = $('foldertree')
  ul.replaceChildren()
  const items: Array<{ path: string; handle: FileSystemHandle; depth: number }> = []
  await listDir(folder, '', 0, items)
  for (const it of items) {
    const li = document.createElement('li')
    li.style.paddingLeft = 8 + it.depth * 14 + 'px'
    const name = it.path.split('/').pop()!
    li.innerHTML = `<span class="ic"></span><span class="nm"></span>`
    li.querySelector('.nm')!.textContent = name
    if (it.handle.kind === 'directory') {
      li.classList.add('dir')
      li.querySelector('.ic')!.textContent = '▾'
    } else {
      li.querySelector('.ic')!.textContent = icon(name)
      li.addEventListener('click', () => void openFile({ kind: 'folder', path: it.path, handle: it.handle as FileSystemFileHandle }))
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        menu(e, [
          ['Open', () => void openFile({ kind: 'folder', path: it.path, handle: it.handle as FileSystemFileHandle })],
          ['Copy to the workspace', async () => {
            const f = await (it.handle as FileSystemFileHandle).getFile()
            await ws.write(name, new Uint8Array(await f.arrayBuffer()))
            await refreshTree()
          }],
        ])
      })
    }
    ul.append(li)
  }
}

/** a folder model and the files beside it, into the workspace (for Run) */
async function copyFolderToWs(path: string) {
  if (!folder) return
  const parts = path.split('/')
  let dir: DirHandle = folder
  for (const p of parts.slice(0, -1)) dir = (await dir.getDirectoryHandle(p)) as DirHandle
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || name.startsWith('.')) continue
    const f = await (h as FileSystemFileHandle).getFile()
    if (f.size > 5_000_000) continue
    await ws.write(name, new Uint8Array(await f.arrayBuffer()), true)
  }
  ws.post({ t: 'changed', name: parts[parts.length - 1] })
  await refreshTree()
}

// the folder is remembered (the browser asks again for permission)
function keepHandle(h: DirHandle) {
  const r = indexedDB.open('xpp-editor', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onsuccess = () => r.result.transaction('kv', 'readwrite').objectStore('kv').put(h, 'folder')
}
function forgetHandle() {
  const r = indexedDB.open('xpp-editor', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('kv')
  r.onsuccess = () => r.result.transaction('kv', 'readwrite').objectStore('kv').delete('folder')
}
function lastHandle(): Promise<DirHandle | null> {
  return new Promise((ok) => {
    const r = indexedDB.open('xpp-editor', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('kv')
    r.onsuccess = () => {
      const g = r.result.transaction('kv').objectStore('kv').get('folder')
      g.onsuccess = () => ok((g.result as DirHandle) ?? null)
      g.onerror = () => ok(null)
    }
    r.onerror = () => ok(null)
  })
}

// ---- problems panel, status, title buttons ---------------------------------------
function updateChrome() {
  const t = activeTab()
  $('st-file').textContent = t ? (t.src.kind === 'ws' ? t.src.name : 'folder: ' + t.src.path) + (t.dirty ? ' ●' : '') : ''
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
  for (const li of $('wstree').querySelectorAll('li')) li.classList.toggle('active', t?.src.kind === 'ws' && li.querySelector('.nm')?.textContent === t.src.name)
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
    ${canFolder ? '<label for="s-reopen">Open my folder every time</label><input type="checkbox" id="s-reopen"><span></span><button type="button" id="s-forget">Forget my folder</button>' : ''}
    <p>Files are kept in this browser (the workspace) and shared with XPP's tab. Clearing the site's data deletes them: Download all (⋯ next to Workspace) keeps a copy.</p>`
  document.body.append(p)
  const sel = (id: string) => p.querySelector<HTMLInputElement & HTMLSelectElement>('#' + id)!
  sel('s-theme').value = settings.theme
  sel('s-style').value = settings.style
  sel('s-font').value = String(settings.fontSize)
  sel('s-wrap').checked = settings.wrap
  sel('s-mini').checked = settings.minimap
  sel('s-auto').checked = settings.autosave
  if (canFolder) {
    sel('s-reopen').checked = settings.reopenFolder
    p.querySelector('#s-forget')!.addEventListener('click', () => {
      forgetHandle()
      folder = null
      $('folderpart').hidden = true
      document.getElementById('reopenbtn')?.remove()
      toast('The folder is forgotten')
    })
  }
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
  for (const f of inp.files ?? []) await ws.write(validName(f.name), new Uint8Array(await f.arrayBuffer()))
  inp.value = ''
  await refreshTree()
})
$<HTMLInputElement>('zipinput').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void restoreZip(f)
  ;(e.target as HTMLInputElement).value = ''
})
$('folderbtn').hidden = !canFolder
$('folderbtn').addEventListener('click', () => void openFolder())
$('folderclose').addEventListener('click', () => {
  folder = null
  $('folderpart').hidden = true
})
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
    ['New file…', () => void newFile()],
    ['Add files…', () => $('upinput').click()],
    null,
    ['Download all (.zip)', () => void downloadAll()],
    ['Restore from .zip…', () => $('zipinput').click()],
    null,
    ['Empty the workspace…', async () => {
      if (!confirm('Delete every file in the workspace? (Download all first to keep a copy.)')) return
      for (const g of groups) for (const t of [...g.tabs]) if (t.src.kind === 'ws') {
        t.dirty = false
        await closeTab(t)
      }
      await ws.clear()
      await refreshTree()
    }],
  ]),
)
$('st-problems').addEventListener('click', () => $('panelwrap').classList.toggle('closed'))
$('panelclose').addEventListener('click', () => $('panelwrap').classList.add('closed'))
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    void saveTab(activeTab())
  }
})
window.addEventListener('beforeunload', (e) => {
  if (groups.some((g) => g.tabs.some((t) => t.dirty && t.src.kind === 'folder'))) e.preventDefault()
})
addEventListener('storage', (e) => e.key === 'xpp-theme' && settings.theme === 'site' && applyTheme())
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => settings.theme === 'site' && applyTheme())

// ---- start -----------------------------------------------------------------------
applyTheme()
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
if (canFolder)
  void lastHandle().then(async (h) => {
    if (!h) return
    // the browser kept the permission ("Allow on every visit"): open it now
    if (settings.reopenFolder && h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') return void openFolder(h)
    const b = document.createElement('button')
    b.id = 'reopenbtn'
    b.type = 'button'
    b.className = 'wide'
    b.textContent = 'Reopen ' + h.name
    b.title = 'Open the folder you used last time (the browser asks for permission)'
    b.addEventListener('click', () => {
      b.remove()
      void openFolder(h)
    })
    $('folderbtn').after(b)
  })
updateChrome()
