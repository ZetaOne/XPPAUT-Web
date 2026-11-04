// Inside the Android app (android/), the page runs in a WebView and the app
// adds a `XppAndroid` object. This file connects the two; on the website it
// does nothing.
import type { XppSession } from './xpp'

interface Bridge {
  /** save a file (base64) in Downloads/XPPAUT; the app shows where it went */
  saveFile(name: string, mime: string, base64: string): void
  /** keep the screen on while XPP computes */
  setKeepScreenOn(on: boolean): void
  /** the page is ready to receive files opened from other apps */
  ready(): void
}

const bridge = (window as unknown as { XppAndroid?: Bridge }).XppAndroid
export const inApp = !!bridge

// Android renames files whose type does not match the name (a.ode as text/plain
// becomes a.ode.txt), so XPP's own formats are saved with a neutral type
const MIME: Record<string, string> = {
  zip: 'application/zip', svg: 'image/svg+xml', png: 'image/png', ps: 'application/postscript',
  eps: 'application/postscript', txt: 'text/plain',
}

/** the app's replacement for a browser download */
export async function appSave(name: string, blob: Blob): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  bridge!.saveFile(name, MIME[ext] || 'application/octet-stream', btoa(bin))
}

/**
 * Set up the app-only behaviour. `session` returns the running XPP (if any);
 * `open` starts XPP with files handed over by the app.
 */
export function setupApp(session: () => XppSession | undefined, open: (files: File[]) => void) {
  if (!bridge) return
  document.documentElement.classList.add('android-app')
  // things an app has no use for: browser pop-up windows
  document.querySelector('#termmode option[value="window"]')?.remove()

  const w = window as unknown as Record<string, unknown>
  // files opened with XPPAUT from another app (file manager, mail, chat…)
  w.xppAppOpen = (files: Array<{ name: string; b64: string }>) => {
    open(files.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name)))
  }
  w.xppAppRunning = () => !!session()?.running
  // Android Back: Esc for XPP; 'exit' when there is nothing to cancel
  w.xppAppBack = () => {
    const s = session()
    if (!s?.running) return 'exit'
    s.pressKey('Escape')
    return 'esc'
  }
  // screen stays on while XPP computes
  let on = false
  setInterval(() => {
    const busy = !!session()?.busy
    if (busy !== on) bridge.setKeepScreenOn((on = busy))
  }, 1000)
  bridge.ready()
}
