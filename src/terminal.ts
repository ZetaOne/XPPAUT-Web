// XPP's text output (stdout/stderr): hidden, in a side panel, or in a
// separate browser window. The whole history is kept so switching modes
// loses nothing.

export type TerminalMode = 'hidden' | 'side' | 'window'

export class Terminal {
  private lines: string[] = []
  private side: HTMLElement
  private sidePre: HTMLPreElement
  private popup: Window | null = null
  private popupPre: HTMLPreElement | null = null
  mode: TerminalMode = 'hidden'
  /** called when the mode changes by itself (popup closed or blocked) */
  onModeChange: (m: TerminalMode) => void = () => {}

  constructor(side: HTMLElement, sidePre: HTMLPreElement) {
    this.side = side
    this.sidePre = sidePre
  }

  write(line: string): void {
    this.lines.push(line)
    if (this.lines.length > 20000) this.lines.splice(0, 5000)
    for (const pre of [this.mode === 'side' ? this.sidePre : null, this.popupPre]) {
      if (!pre) continue
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4
      pre.append(line + '\n')
      if (atEnd) pre.scrollTop = pre.scrollHeight
    }
  }

  clear(): void {
    this.lines = []
    this.sidePre.textContent = ''
    if (this.popupPre) this.popupPre.textContent = ''
  }

  text(): string {
    return this.lines.join('\n') + '\n'
  }

  /** Switch mode. 'window' must be called from a click (pop-up rules);
      returns the mode actually in use. */
  setMode(mode: TerminalMode): TerminalMode {
    if (mode === 'window' && !this.openPopup()) mode = 'side'
    if (mode !== 'window' && this.popup) {
      const p = this.popup
      this.popup = null
      this.popupPre = null
      p.close()
    }
    this.mode = mode
    this.side.hidden = mode !== 'side'
    if (mode === 'side') {
      this.sidePre.textContent = this.text()
      this.sidePre.scrollTop = this.sidePre.scrollHeight
    }
    return mode
  }

  private openPopup(): boolean {
    if (this.popup && !this.popup.closed) {
      this.popup.focus()
      return true
    }
    const w = window.open('', 'xpp-terminal', 'popup,width=640,height=420')
    if (!w) return false
    const d = w.document
    d.title = 'XPP output'
    d.head.innerHTML = `<style>
      :root { color-scheme: light dark; }
      body { margin: 0; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
             background: #1b1c1e; color: #e4e4e0; }
      pre { margin: 0; padding: 8px 10px; height: 100vh; box-sizing: border-box;
            overflow: auto; white-space: pre-wrap; }
    </style>`
    d.body.innerHTML = '<pre></pre>'
    this.popupPre = d.querySelector('pre')
    this.popupPre!.textContent = this.text()
    this.popupPre!.scrollTop = this.popupPre!.scrollHeight
    this.popup = w
    w.addEventListener('pagehide', () => {
      if (this.popup !== w) return
      this.popup = null
      this.popupPre = null
      this.mode = 'hidden'
      this.onModeChange('hidden')
    })
    return true
  }

  closeAll(): void {
    this.popup?.close()
  }
}
