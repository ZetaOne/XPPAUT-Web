// The workspace: XPP's working folder kept in the browser (IndexedDB), so files
// stay between visits and the editor (editor.html, another tab) sees the same
// files as XPP. Changes are announced to the other tabs on a BroadcastChannel.
//
//   XPP's tab      writes what XPP saves into the workspace, and copies files
//                  the editor changed into XPP's folder
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
  | { t: 'cleared'; from: string }
  | { t: 'run-ode'; name: string; from: string }
  | { t: 'run-script'; name: string; from: string }
  | { t: 'hello'; from: string }
  | { t: 'xpp-here'; ode: string; from: string }

const DB = 'xpp-workspace'
const STORE = 'files'
/** who is talking (each tab) */
export const tabId = Math.random().toString(36).slice(2)

let dbp: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' })
    r.onsuccess = () => ok(r.result)
    r.onerror = () => fail(r.error)
  }))
}

function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((ok, fail) => {
        const r = f(d.transaction(STORE, mode).objectStore(STORE))
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
  post({ t: 'cleared' })
}

export async function readAll(): Promise<WsFile[]> {
  try {
    return await tx<WsFile[]>('readonly', (s) => s.getAll() as IDBRequest<WsFile[]>)
  } catch {
    return []
  }
}

export const textOf = (d: Uint8Array) => new TextDecoder().decode(d)
export const bytesOf = (t: string) => new TextEncoder().encode(t)
