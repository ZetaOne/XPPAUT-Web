// Phones and tablets: detect them, and add touch-friendly controls around
// XPP (window tabs, zoom buttons, an on-screen key strip, a ☰ toolbar).
// Desktops are left exactly as they are.
import type { XppSession } from './xpp'

export type Device = 'phone' | 'tablet' | 'desktop'
export type ViewMode = 'auto' | 'mobile' | 'desktop'

const touchQuery = matchMedia('(hover: none) and (pointer: coarse)')

/** what this device is, by what it can do (not by its browser's name) */
export function detectDevice(mode: ViewMode): Device {
  const small = Math.min(window.innerWidth, window.innerHeight) < 600
  if (mode === 'desktop') return 'desktop'
  if (mode === 'mobile') return small ? 'phone' : 'tablet'
  if (!touchQuery.matches) return 'desktop'
  return small ? 'phone' : 'tablet'
}

/** Builds the mobile controls once; `apply` switches them on and off. */
export class MobileUI {
  device: Device = 'desktop'
  private session: XppSession | null = null
  private ctrl = false
  private tabs: HTMLElement
  private zoomBar: HTMLElement
  private keys: HTMLElement
  private input: HTMLInputElement
  private onChange: (d: Device) => void

  constructor(app: HTMLElement, desktop: HTMLElement, onChange: (d: Device) => void = () => {}) {
    this.onChange = onChange

    // window tabs (phones: one window at a time)
    this.tabs = document.createElement('nav')
    this.tabs.className = 'wintabs'
    this.tabs.setAttribute('aria-label', 'XPP windows')

    // zoom: − fit +
    this.zoomBar = document.createElement('div')
    this.zoomBar.className = 'zoombar'
    this.zoomBar.innerHTML =
      '<button type="button" data-z="kbd" aria-label="Keyboard">⌨</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-z="fit" aria-label="Fit window to screen">Fit</button>' +
      '<button type="button" data-z="in" aria-label="Zoom in">+</button>'
    this.zoomBar.addEventListener('click', (e) => {
      const z = (e.target as HTMLElement).dataset.z
      if (!z || !this.session) return
      if (z === 'kbd') return this.toggleKeyboard()
      if (z === 'fit') return this.session.fit()
      const v = this.session.getView()
      const f = z === 'in' ? 1.25 : 0.8
      const cx = desktop.clientWidth / 2
      const cy = desktop.clientHeight / 2
      const s = Math.min(4, Math.max(0.25, v.s * f))
      this.session.setView(s, cx - ((cx - v.tx) / v.s) * s, cy - ((cy - v.ty) / v.s) * s)
    })

    // key strip: keys phone keyboards lack, plus a button for the keyboard
    this.keys = document.createElement('div')
    this.keys.className = 'keystrip'
    const strip: Array<[string, string, string]> = [
      ['kbd', '⌨', 'Hide the keyboard'],
      ['Escape', 'Esc', 'Escape'],
      ['Tab', 'Tab', 'Tab'],
      ['ctrl', 'Ctrl', 'Control (applies to the next key)'],
      ['ArrowLeft', '←', 'Left'],
      ['ArrowUp', '↑', 'Up'],
      ['ArrowDown', '↓', 'Down'],
      ['ArrowRight', '→', 'Right'],
      ['Backspace', '⌫', 'Backspace'],
      ['Enter', '⏎', 'Enter'],
    ]
    for (const [k, label, name] of strip) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.key = k
      b.textContent = label
      b.title = name
      b.setAttribute('aria-label', name)
      this.keys.append(b)
    }
    // pointerdown + preventDefault keeps the keyboard open (no focus change)
    this.keys.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('button')
      if (!b) return
      e.preventDefault()
      const k = b.dataset.key!
      if (k === 'kbd') return this.toggleKeyboard()
      if (k === 'ctrl') {
        this.ctrl = !this.ctrl
        b.classList.toggle('on', this.ctrl)
        return
      }
      this.send(k)
    })

    // hidden text field: focusing it brings up the device keyboard. Mobile
    // keyboards often report keys as "Unidentified", so read typed text from
    // input events; named keys (Enter, Backspace...) come as keydowns.
    this.input = document.createElement('input')
    this.input.className = 'kbdsink'
    this.input.setAttribute('aria-label', 'Type into XPP')
    this.input.autocomplete = 'off'
    this.input.setAttribute('autocorrect', 'off')
    this.input.setAttribute('autocapitalize', 'off')
    this.input.spellcheck = false
    this.input.addEventListener('keydown', (e) => {
      const named = ['Enter', 'Backspace', 'Escape', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete']
      if (named.includes(e.key)) {
        e.preventDefault()
        this.send(e.key)
      }
    })
    this.input.addEventListener('beforeinput', (e) => {
      const ie = e as InputEvent
      e.preventDefault()
      if (ie.inputType === 'deleteContentBackward') this.send('Backspace')
      else if (ie.inputType === 'insertLineBreak' || ie.inputType === 'insertParagraph') this.send('Enter')
      else if (ie.data) for (const ch of ie.data) this.send(ch)
    })
    this.input.addEventListener('blur', () => this.showStrip(false))

    // tabs in the toolbar row, key strip at the bottom, zoom over the desktop
    app.querySelector('header .menubtn')!.before(this.tabs)
    app.append(this.keys)
    desktop.append(this.zoomBar)
    document.body.append(this.input)
  }

  attach(session: XppSession) {
    this.session = session
    session.onWindowsChanged = () => this.renderTabs()
    this.applyToSession()
  }

  /** (re)apply the layout for `device` */
  apply(device: Device) {
    const changed = device !== this.device
    this.device = device
    document.documentElement.dataset.device = device
    this.applyToSession()
    if (changed) this.onChange(device)
  }

  private applyToSession() {
    const s = this.session
    if (!s) return
    s.touch = this.device !== 'desktop'
    s.setPhone(this.device === 'phone')
    if (this.device === 'desktop') s.setView(1, 0, 0)
    this.renderTabs()
  }

  private send(key: string) {
    this.session?.pressKey(key, this.ctrl)
    if (this.ctrl) {
      this.ctrl = false
      this.keys.querySelector('[data-key="ctrl"]')?.classList.remove('on')
    }
  }

  /** ⌨: the device keyboard plus the strip of extra keys, together */
  private toggleKeyboard() {
    if (document.activeElement === this.input) {
      this.input.blur()
      this.showStrip(false)
    } else {
      this.showStrip(true)
      this.input.focus({ preventScroll: true })
    }
  }

  private showStrip(on: boolean) {
    document.documentElement.classList.toggle('kbd-open', on)
    this.zoomBar.querySelector('[data-z="kbd"]')?.classList.toggle('on', on)
  }

  private renderTabs() {
    const s = this.session
    this.tabs.replaceChildren()
    if (!s || this.device !== 'phone') return
    const wins = s.windows()
    if (wins.length < 2) return // one window: nothing to switch to
    for (const w of wins) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = w.title.replace(/^XPP Ver [\d.]+ >> /, '')
      b.title = w.title
      if (w.active) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => s.activate(w.id))
      this.tabs.append(b)
    }
  }
}

/** re-evaluate on rotation, resize, or when a mouse/keyboard is attached */
export function watchDevice(update: () => void) {
  let t = 0
  const later = () => {
    clearTimeout(t)
    t = window.setTimeout(update, 150)
  }
  window.addEventListener('resize', later)
  window.addEventListener('orientationchange', later)
  touchQuery.addEventListener?.('change', later)
}
