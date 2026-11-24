// Checking an .ode file without disturbing the running XPP: a second,
// throw-away XPP (same WebAssembly, compiled once) reads the file with
// -qpars (parameters as read) and then -qics (initial values as read), and
// src/odelint.ts turns what it said into issues. Used by the editor
// (src/odeedit.ts), Android app only.
import { xppBuild } from './xpp'
import { checkWith, type Issue, type Run } from './odelint'

export * from './odelint'

let compiled: Promise<WebAssembly.Module> | null = null
let factory: Promise<(o: object) => Promise<any>> | null = null

function loadXpp() {
  const { dir } = xppBuild()
  const base = (p: string) => new URL(dir + p, document.baseURI).href
  compiled ??= fetch(base('xppaut.wasm')).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b))
  factory ??= import(/* @vite-ignore */ base('xppaut.mjs')).then((m) => m.default)
  return Promise.all([compiled, factory])
}

/** run XPP on `text` with a query flag; its messages and the query file */
async function runXpp(text: string, flag: '-qpars' | '-qics'): Promise<Run> {
  const [module, createXpp] = await loadXpp()
  const messages: string[] = []
  let fs: any = null
  let crashed = false
  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    createXpp({
      noInitialRun: true,
      print: (s: string) => messages.push(s),
      printErr: (s: string) => messages.push(s),
      onExit: finish,
      instantiateWasm: (imports: WebAssembly.Imports, ok: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
        WebAssembly.instantiate(module, imports).then((inst) => ok(inst, module))
        return {}
      },
    }).then((m: any) => {
      fs = m.FS
      fs.mkdir('/chk')
      fs.chdir('/chk')
      fs.writeFile('/chk/model.ode', text)
      // exit() ends a run with an ExitStatus exception; anything else is a crash
      const failed = (e: any) => {
        if (e?.name !== 'ExitStatus') crashed = true
        finish()
      }
      try {
        const r = m.callMain(['model.ode', flag, '-outfile', '/chk/q.txt'])
        if (r?.then) r.then(finish, failed)
        else finish()
      } catch (e) {
        failed(e)
      }
    }, (e: unknown) => {
      crashed = true
      finish()
      void e
    })
    setTimeout(finish, 8000) // never hang the editor
  })
  let query = ''
  try {
    query = fs?.readFile('/chk/q.txt', { encoding: 'utf8' }) ?? ''
  } catch { /* XPP stopped before writing it */ }
  return { messages, query, crashed }
}

/** XPP's verdict on `text` as a list of issues (empty: XPP reads it as written) */
export function checkOde(text: string): Promise<Issue[]> {
  return checkWith(text, runXpp)
}
