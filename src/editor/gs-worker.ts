// PostScript -> PNG pages with Ghostscript compiled to WebAssembly
// (@jspawn/ghostscript-wasm, AGPL-3.0; https://ghostscript.com), in a worker so
// the page stays responsive. Loaded only when a .ps file is opened.
import gsUrl from '@jspawn/ghostscript-wasm/gs.js?url'
import wasmUrl from '@jspawn/ghostscript-wasm/gs.wasm?url'

type Gs = { FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array }; callMain(args: string[]): number }
// Ghostscript's loader is a classic script that defines createModule: run it
// as one (bundled as a module, its global would be hidden)
let factory: Promise<(o: object) => Promise<Gs>> | null = null
const load = () =>
  (factory ??= fetch(gsUrl)
    .then((r) => r.text())
    .then((src) => new Function('module', 'exports', src + '\n;return Module')(undefined, undefined)))

self.onmessage = async (e: MessageEvent<{ ps: Uint8Array; dpi: number }>) => {
  const log: string[] = []
  try {
    const createGs = await load()
    const gs = await createGs({ locateFile: () => wasmUrl, print: (s: string) => log.push(s), printErr: (s: string) => log.push(s) })
    gs.FS.writeFile('in.ps', e.data.ps)
    gs.callMain(['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dEPSCrop', '-sDEVICE=png16m', `-r${e.data.dpi}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-sOutputFile=page%d.png', 'in.ps'])
    const pages: Uint8Array[] = []
    for (let i = 1; ; i++) {
      try {
        pages.push(gs.FS.readFile(`page${i}.png`))
      } catch {
        break
      }
    }
    ;(self as unknown as Worker).postMessage({ pages, log: log.join('\n') })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ pages: [], log: log.join('\n') + '\n' + String(err) })
  }
}
