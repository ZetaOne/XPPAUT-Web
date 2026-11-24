// The workspace: XPP's working folders kept in the browser (IndexedDB), so files
// stay between visits and the editor (editor.html, another tab) sees the same
// files as XPP. Changes are announced to the other tabs on a BroadcastChannel.
//
// One folder per model: a file is kept as "folder/name" (lecar/lecar.ode,
// lecar/run.xps). When XPP runs a model, only that model's folder becomes
// XPP's working folder, and what XPP saves goes back into it.
//
//   XPP's tab      writes what XPP saves into the model's folder, and copies
//                  files the editor changed there into XPP's folder
//   the editor     reads and writes the workspace, and asks XPP's tab to run
//                  a model or a script

export interface WsFile {
  name: string
  data: Uint8Array
  mtime: number
}

export type WsMessage =
  | { t: 'changed'; name: string; from: string }
  | { t: 'deleted'; name: string; from: string }
  /** many files changed (folders emptied, renamed, reordered): read the list again */
  | { t: 'cleared'; from: string }
  /** start the model `name` ("folder/x.ode"), then run `script` (a name in its folder) */
  | { t: 'run-ode'; name: string; script?: string; from: string }
  | { t: 'run-script'; name: string; from: string }
  | { t: 'hello'; from: string }
  | { t: 'xpp-here'; ode: string; dir?: string; from: string }
  /** XPP's output, a few lines at a time (the editor's terminal) */
  | { t: 'out'; lines: string[]; from: string }
  /** the script line now running ("folder/x.xps"; line 0: no script runs) */
  | { t: 'script-line'; name: string; line: number; from: string }
  /** the editor's command bar: keys for XPP's main window or AUTO's */
  | { t: 'cmd'; keys: string[]; to?: 'auto'; from: string }
  /** the editor's sliders (XPP's own Par/Var sliders k = 0..2) */
  | { t: 'params-req'; from: string }
  | { t: 'params'; list: Array<{ name: string; value: number; ic: boolean }>; sliders: Array<{ name: string; value: number; lo: number; hi: number } | null>; from: string }
  | { t: 'slider-setup'; k: number; name: string; lo: number; hi: number; value: number; from: string }
  | { t: 'slider-ok'; k: number; ok: boolean; from: string }
  | { t: 'slider-move'; k: number; value: number; from: string }

const DB = 'xpp-workspace'
const STORE = 'files'
/** folder -> when its model was last opened in XPP (or files were added) */
const FOLDERS = 'folders'
/** who is talking (each tab) */
export const tabId = Math.random().toString(36).slice(2)

// ---- paths: "folder/name" --------------------------------------------------------
export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')
export const baseOf = (path: string) => path.slice(path.indexOf('/') + 1)
export const join = (dir: string, name: string) => dir + '/' + name
/** the folder a model lives in: its name without .ode */
export const folderFor = (ode: string) => ode.replace(/\.ode$/i, '').replace(/[\\/]/g, '_').trim() || 'model'
export const UNSORTED = 'unsorted'
/** where a loose file belongs, given the models' folder names: lecar-auto.xps -> lecar */
export function guessDir(name: string, dirs: string[]): string {
  if (/\.ode$/i.test(name)) return folderFor(name)
  const low = name.toLowerCase()
  const hit = dirs.filter((d) => low.startsWith(d.toLowerCase())).sort((a, b) => b.length - a.length)[0]
  if (hit) return hit
  return dirs.length === 1 ? dirs[0] : UNSORTED
}

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 2)
    r.onupgradeneeded = (e) => {
      const d = r.result
      const t = r.transaction!
      if (e.oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'name' })
      if (e.oldVersion < 2) {
        const folders = d.createObjectStore(FOLDERS, { keyPath: 'dir' })
        // version 1 kept every file in one folder: sort them into the models' folders
        const files = t.objectStore(STORE)
        const all = files.getAll()
        all.onsuccess = () => {
          const list = all.result as WsFile[]
          const dirs = [...new Set(list.filter((f) => /\.ode$/i.test(f.name)).map((f) => folderFor(f.name)))]
          const opened = new Map<string, number>()
          for (const f of list) {
            if (f.name.includes('/')) continue
            const dir = guessDir(f.name, dirs)
            files.delete(f.name)
            files.put({ ...f, name: join(dir, f.name) })
            opened.set(dir, Math.max(opened.get(dir) ?? 0, f.mtime))
          }
          for (const [dir, at] of opened) folders.put({ dir, opened: at })
        }
      }
    }
    r.onsuccess = () => {
      // a newer page wants to upgrade: let it
      r.result.onversionchange = () => r.result.close()
      ok(r.result)
    }
    r.onerror = () => fail(r.error)
  }))
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>, store = STORE): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((ok, fail) => {
        const r = f(d.transaction(store, mode).objectStore(store))
        r.onsuccess = () => ok(r.result)
        r.onerror = () => fail(r.error)
      }),
  )
}

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('xpp-workspace') : null
const listeners: Array<(m: WsMessage) => void> = []
channel?.addEventListener('message', (e) => {
  const m = e.data as WsMessage
  if (m && m.from !== tabId) for (const l of listeners) l(m)
})

export function onMessage(f: (m: WsMessage) => void) {
  listeners.push(f)
}

type Unsent<T> = T extends unknown ? Omit<T, 'from'> : never
export function post(m: Unsent<WsMessage>) {
  channel?.postMessage({ ...m, from: tabId })
}

export async function list(): Promise<Array<{ name: string; size: number; mtime: number }>> {
  try {
    const all = await tx<WsFile[]>('readonly', (s) => s.getAll() as IDBRequest<WsFile[]>)
    return all.map((f) => ({ name: f.name, size: f.data.length, mtime: f.mtime })).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export async function read(name: string): Promise<Uint8Array | null> {
  try {
    const f = await tx<WsFile | undefined>('readonly', (s) => s.get(name) as IDBRequest<WsFile | undefined>)
    return f ? f.data : null
  } catch {
    return null
  }
}

/** keep a file (and tell the other tabs, unless `quiet`) */
export async function write(name: string, data: Uint8Array, quiet = false): Promise<void> {
  await tx('readwrite', (s) => s.put({ name, data: new Uint8Array(data), mtime: Date.now() }))
  if (!quiet) post({ t: 'changed', name })
}

export async function remove(name: string, quiet = false): Promise<void> {
  await tx('readwrite', (s) => s.delete(name))
  if (!quiet) post({ t: 'deleted', name })
}

export async function clear(): Promise<void> {
  await tx('readwrite', (s) => s.clear())
  await tx('readwrite', (s) => s.clear(), FOLDERS)
  post({ t: 'cleared' })
}

export async function readAll(): Promise<WsFile[]> {
  try {
    return await tx<WsFile[]>('readonly', (s) => s.getAll() as IDBRequest<WsFile[]>)
  } catch {
    return []
  }
}

// ---- folders ---------------------------------------------------------------------
/** the model `dir` was opened now (it goes to the top of the editor's list) */
export async function touch(dir: string, quiet = false): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ dir, opened: Date.now() }), FOLDERS)
    if (!quiet) post({ t: 'cleared' }) // the editor redraws its list
  } catch {
    /* storage blocked */
  }
}

/** every folder (also empty ones), the most recently opened first */
export async function folders(): Promise<Array<{ dir: string; opened: number; files: Array<{ name: string; size: number; mtime: number }> }>> {
  const files = await list()
  let meta: Array<{ dir: string; opened: number }> = []
  try {
    meta = await tx('readonly', (s) => s.getAll() as IDBRequest<Array<{ dir: string; opened: number }>>, FOLDERS)
  } catch {
    /* none */
  }
  const by = new Map<string, { dir: string; opened: number; files: Array<{ name: string; size: number; mtime: number }> }>()
  for (const m of meta) by.set(m.dir, { dir: m.dir, opened: m.opened, files: [] })
  for (const f of files) {
    const dir = dirOf(f.name) || UNSORTED
    const g = by.get(dir) ?? { dir, opened: 0, files: [] }
    g.files.push(f)
    g.opened ||= 0
    by.set(dir, g)
  }
  // a folder never opened: as recent as its newest file
  for (const g of by.values()) if (!g.opened) g.opened = Math.max(0, ...g.files.map((f) => f.mtime))
  return [...by.values()].sort((a, b) => b.opened - a.opened || a.dir.localeCompare(b.dir))
}

export async function removeFolder(dir: string): Promise<void> {
  for (const f of await list()) if (dirOf(f.name) === dir) await tx('readwrite', (s) => s.delete(f.name))
  try {
    await tx('readwrite', (s) => s.delete(dir), FOLDERS)
  } catch {
    /* none */
  }
  post({ t: 'cleared' })
}

export async function renameFolder(dir: string, to: string): Promise<void> {
  for (const f of await readAll()) if (dirOf(f.name) === dir) {
    await tx('readwrite', (s) => s.put({ ...f, name: join(to, baseOf(f.name)) }))
    await tx('readwrite', (s) => s.delete(f.name))
  }
  try {
    const m = await tx<{ dir: string; opened: number } | undefined>('readonly', (s) => s.get(dir) as IDBRequest<{ dir: string; opened: number } | undefined>, FOLDERS)
    await tx('readwrite', (s) => s.delete(dir), FOLDERS)
    await tx('readwrite', (s) => s.put({ dir: to, opened: m?.opened ?? Date.now() }), FOLDERS)
  } catch {
    /* none */
  }
  post({ t: 'cleared' })
}

export const textOf = (d: Uint8Array) => new TextDecoder().decode(d)
export const bytesOf = (t: string) => new TextEncoder().encode(t)
