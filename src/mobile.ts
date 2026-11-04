// Phones and tablets: detect them, and add touch-friendly controls around
// XPP (window tabs, zoom buttons, an on-screen key strip, a ☰ toolbar).
// Desktops are left exactly as they are.
import type { XppSession } from './xpp'

export type Device = 'phone' | 'tablet' | 'desktop'

/** a Cmd panel button: keys sent to XPP, or a function; `page` switches the
 *  panel's page, `stay` keeps it open, `typing` opens the keyboard after */
interface Cmd {
  label: string
  hint: string
  keys?: string[]
  to?: 'auto'
  fn?: () => void
  page?: string
  stay?: boolean
  typing?: boolean
  tip?: string
}

/** XPP's AUTO window ("It's AUTO man!") */
const isAuto = (title: string) => title.startsWith("It's AUTO")
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
  private cmds: HTMLElement
  private lastBack = 0
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
      '<button type="button" data-z="cmd" aria-label="XPP commands">Cmd</button>' +
      '<button type="button" data-z="kbd" aria-label="Keyboard">⌨</button>' +
      '<button type="button" data-z="out" aria-label="Zoom out">−</button>' +
      '<button type="button" data-z="fit" aria-label="Fit window to screen">Fit</button>' +
      '<button type="button" data-z="in" aria-label="Zoom in">+</button>'
    this.zoomBar.addEventListener('click', (e) => {
      const z = (e.target as HTMLElement).dataset.z
      if (!z || !this.session) return
      if (z === 'kbd') return this.toggleKeyboard()
      if (z === 'cmd') return this.toggleCommands()
      if (z === 'fit') return this.session.fit()
      const v = this.session.getView()
      const f = z === 'in' ? 1.25 : 0.8
      const cx = desktop.clientWidth / 2
      const cy = desktop.clientHeight / 2
      const s = Math.min(4, Math.max(0.25, v.s * f))
      this.session.setView(s, cx - ((cx - v.tx) / v.s) * s, cy - ((cy - v.ty) / v.s) * s)
    })

    // command panel: XPP's keyboard commands, one tap each, in pages: XPP's
    // main menu, its Numerics menu, and the AUTO window (shown when that is
    // in front). Keys go to the window the command belongs to.
    this.cmds = document.createElement('div')
    this.cmds.className = 'cmdpanel'
    this.cmds.setAttribute('role', 'menu')
    const common: Cmd[] = [
      { label: 'Esc', hint: 'cancel', keys: ['Escape'], stay: true },
      { label: 'Enter', hint: 'accept', keys: ['Enter'], stay: true },
      { label: 'Keyboard', hint: '⌨', fn: () => this.toggleKeyboard() },
    ]
    // Numerics entries that ask for a value on XPP's command line
    const num = (label: string, key: string, typing = false): Cmd => ({ label, hint: key.toUpperCase(), keys: [key], typing, stay: !typing })
    this.pages = {
      main: [
        { label: 'Integrate', hint: 'I G', keys: ['i', 'g'] },
        { label: 'Tap to start', hint: 'I I', keys: ['i', 'i'], tip: 'Tap the graph to start a trajectory there, as often as you like. Esc (or Back) ends.' },
        { label: 'Last', hint: 'I L', keys: ['i', 'l'] },
        { label: 'Continue', hint: 'C', keys: ['c'] },
        { label: 'Nullclines', hint: 'N N', keys: ['n', 'n'] },
        { label: 'Direction field', hint: 'D D', keys: ['d', 'd'] },
        { label: 'Erase', hint: 'E', keys: ['e'] },
        { label: 'Fit window', hint: 'W F', keys: ['w', 'f'] },
        { label: 'Restore', hint: 'R', keys: ['r'] },
        { label: 'Sing pts', hint: 'S G', keys: ['s', 'g'] },
        { label: 'Fixed point here', hint: 'S M', keys: ['s', 'm'], tip: 'Tap near a fixed point: XPP finds it and shows its stability and eigenvalues' },
        { label: 'Xi vs t', hint: 'X', keys: ['x'] },
        { label: 'Numerics…', hint: 'U', keys: ['u'], page: 'numerics' },
        { label: 'AUTO', hint: 'F A', keys: ['f', 'a'] },
        { label: 'Calculator', hint: 'F C', keys: ['f', 'c'] },
        { label: 'Tips', hint: 'touch help', fn: () => this.showTips() },
        ...common,
      ],
      numerics: [
        num('Total', 't', true), num('Start time', 's', true), num('Transient', 'r', true),
        num('Dt', 'd', true), num('Method', 'm'), num('nOutput', 'o', true),
        num('Bounds', 'b', true), num('Ncline ctrl', 'n'), num('Sing pt ctrl', 'i'),
        num('Delay', 'e', true), num('Color code', 'c'), num('Poincaré map', 'p'),
        num('Stochastic', 'h'), num('Ruelle plot', 'u'), num('Lookup', 'k'),
        num('Bndry val', 'v'), num('Averaging', 'a'),
        { label: 'Done', hint: 'Esc', keys: ['Escape'], page: 'main' },
        ...common.slice(1),
      ],
      auto: [
        { label: 'Run', hint: 'R', keys: ['r'], to: 'auto' },
        { label: 'Grab', hint: 'G', keys: ['g'], to: 'auto', stay: true, tip: 'Pick a point: ◀ ▶ step, Tab jumps to the next label, Grab it (Enter) takes it, Esc cancels' },
        { label: '◀ Point', hint: '←', keys: ['ArrowLeft'], stay: true },
        { label: 'Point ▶', hint: '→', keys: ['ArrowRight'], stay: true },
        { label: 'Next label', hint: 'Tab', keys: ['Tab'], stay: true },
        { label: 'Grab it', hint: 'Enter', keys: ['Enter'], stay: true },
        { label: 'Parameter', hint: 'P', keys: ['p'], to: 'auto' },
        { label: 'Axes', hint: 'A', keys: ['a'], to: 'auto' },
        { label: 'Numerics', hint: 'N', keys: ['n'], to: 'auto' },
        { label: 'Usr period', hint: 'U', keys: ['u'], to: 'auto' },
        { label: 'Clear', hint: 'C', keys: ['c'], to: 'auto' },
        { label: 'reDraw', hint: 'D', keys: ['d'], to: 'auto' },
        { label: 'File', hint: 'F', keys: ['f'], to: 'auto' },
        { label: 'XPP window', hint: 'main menu', fn: () => this.session?.activate(this.session.mainWindow) },
        ...common,
      ],
    }
    this.renderPage('main')

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
      // more room in landscape: keys XPP uses in its data browser and lists
      ['Home', 'Home', 'Home'],
      ['End', 'End', 'End'],
      ['PageUp', 'PgUp', 'Page up'],
      ['PageDown', 'PgDn', 'Page down'],
      ['Delete', 'Del', 'Delete'],
      ['Backspace', '⌫', 'Backspace'],
      ['Enter', '⏎', 'Enter'],
      // symbols for formulas and values (fewer keyboard page switches)
      ...[...'()^*/+-=,.\''].map((c): [string, string, string] => ['text:' + c, c, c]),
    ]
    for (const [k, label, name] of strip) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.key = k
      if (['Home', 'End', 'PageUp', 'PageDown', 'Delete'].includes(k)) b.className = 'wide'
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
      if (k.startsWith('text:')) {
        for (const ch of k.slice(5)) this.send(ch)
        return
      }
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

    // Stop: shown while XPP computes (Esc is how XPP itself stops a run)
    this.stop = document.createElement('button')
    this.stop.type = 'button'
    this.stop.className = 'stopbtn'
    this.stop.textContent = '■ Stop'
    this.stop.title = 'Stop the integration or continuation (Esc)'
    this.stop.hidden = true
    this.stop.addEventListener('click', () => this.session?.pressKey('Escape'))
    let busySince = 0
    setInterval(() => {
      const busy = !!this.session?.busy && this.device !== 'desktop'
      if (!busy) busySince = 0
      else if (!busySince) busySince = performance.now()
      // only for runs that take a while: no flicker on short ones
      this.stop.hidden = !(busy && performance.now() - busySince > 700)
    }, 250)

    // tabs in the toolbar row, key strip at the bottom, zoom over the desktop
    app.querySelector('header .menubtn')!.before(this.tabs)
    app.append(this.keys)
    desktop.append(this.zoomBar, this.cmds, this.stop)
    document.body.append(this.input)

    // Esc without a keyboard: the Android Back gesture/button (twice quickly
    // still leaves the page)
    window.addEventListener('popstate', () => {
      if (!this.session?.running || this.device === 'desktop') return
      const now = performance.now()
      if (now - this.lastBack < 800) return history.back() // leave
      this.lastBack = now
      this.session.pressKey('Escape')
      history.pushState({ xpp: 1 }, '')
    })

    // keep the app (key strip, zoom buttons) above the on-screen keyboard in
    // browsers that only shrink the visual viewport
    const vv = window.visualViewport
    if (vv) {
      const fit = () => {
        if (this.device === 'desktop') return document.documentElement.style.removeProperty('--app-h')
        document.documentElement.style.setProperty('--app-h', Math.round(vv.height) + 'px')
        window.scrollTo(0, 0)
      }
      vv.addEventListener('resize', fit)
      this.fitViewport = fit
    }
  }

  private fitViewport: () => void = () => {}

  /** add a command to the Cmd panel's main page (before Esc/Enter/Keyboard) */
  addCommand(label: string, hint: string, fn: () => void) {
    const main = this.pages.main
    main.splice(main.findIndex((c) => c.label === 'Esc'), 0, { label, hint, fn })
    if (this.page === 'main') this.renderPage('main')
  }

  private pages: Record<string, Cmd[]> = {}
  private page = 'main'

  private renderPage(name: string) {
    this.page = name
    this.cmds.replaceChildren()
    this.cmds.dataset.page = name
    const titles: Record<string, string> = { numerics: 'Numerics', auto: 'AUTO' }
    if (titles[name]) {
      const h = document.createElement('div')
      h.className = 'cmdpanel-title'
      h.textContent = titles[name]
      this.cmds.append(h)
    }
    for (const c of this.pages[name]) {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      b.innerHTML = `<span></span><small></small>`
      b.querySelector('span')!.textContent = c.label
      b.querySelector('small')!.textContent = c.hint
      b.addEventListener('click', () => this.run(c))
      this.cmds.append(b)
    }
  }

  private run(c: Cmd) {
    const s = this.session
    if (!s) return
    if (c.fn) {
      this.toggleCommands(false)
      return c.fn()
    }
    if (c.keys) {
      // menu keys go to their window; Esc/Enter/arrows to the active one
      const nav = ['Escape', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
      const target = c.to ?? (nav.includes(c.keys[0]) ? 'active' : 'main')
      if (target === 'auto') {
        const a = s.windows().find((w) => isAuto(w.title))
        if (a) s.activate(a.id)
      } else if (target === 'main') s.activate(s.mainWindow)
      for (const k of c.keys) s.pressKey(k)
    }
    if (c.page) return this.renderPage(c.page)
    if (c.tip) this.tip(c.tip)
    if (c.typing) {
      // XPP asks for a value on its command line: bring up the keyboard
      this.toggleCommands(false)
      if (!this.keyboardOpen()) this.toggleKeyboard()
      return
    }
    if (!c.stay) this.toggleCommands(false)
  }

  private stop: HTMLButtonElement
  /** short messages for the user (set by the page) */
  tip: (msg: string) => void = () => {}

  attach(session: XppSession) {
    this.session = session
    session.onWindowsChanged = () => this.renderTabs()
    session.onTwoFingerTap = () => {
      if (this.device !== 'desktop') session.pressKey('Escape')
    }
    // a history entry for Back to pop (Back = Esc)
    if (this.device !== 'desktop' && !history.state?.xpp) history.pushState({ xpp: 1 }, '')
    this.applyToSession()
    // first time on a phone or tablet: how touch works here
    let seen = '1'
    try {
      seen = localStorage.getItem('xpp-tips') ?? ''
      localStorage.setItem('xpp-tips', '1')
    } catch { /* private mode: show nothing */ }
    if (!seen && this.device !== 'desktop') setTimeout(() => this.showTips(), 1200)
  }

  /** a short card on touch controls (first run, and Cmd -> Tips) */
  showTips() {
    document.querySelector('.tips')?.remove()
    const d = document.createElement('div')
    d.className = 'tips'
    d.setAttribute('role', 'dialog')
    d.setAttribute('aria-label', 'Touch tips')
    d.innerHTML = `<h3>XPP on a touch screen</h3>
      <ul>
        <li><b>Tap</b> = click, <b>drag</b> = drag. <b>Hold</b> a finger to magnify
          what is under it, with the graph's coordinates; a longer hold is a right click.</li>
        <li><b>Pinch</b> to zoom, <b>two fingers</b> to move; <b>Fit</b> fits the window.
          Turn the phone sideways for a larger graph.</li>
        <li><b>Cmd</b>: XPP's commands, one tap each: <i>Tap to start</i> (tap the graph to
          start trajectories), <i>Sliders</i> for parameters, <i>Numerics</i>, and AUTO's
          commands when the AUTO window is in front.</li>
        <li><b>⌨</b>: the keyboard, with Esc, Tab, arrows, symbols and the model's names.
          <b>Back</b> or a <b>two-finger tap</b> is Esc.</li>
      </ul>
      <button type="button">Got it</button>`
    d.querySelector('button')!.addEventListener('click', () => d.remove())
    document.body.append(d)
  }

  /** portrait or landscape, by the shape of the window */
  orient: 'portrait' | 'landscape' = 'portrait'

  /** (re)apply the layout for `device` */
  apply(device: Device) {
    const changed = device !== this.device
    const orient = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
    const turned = orient !== this.orient
    this.device = device
    this.orient = orient
    document.documentElement.dataset.device = device
    document.documentElement.dataset.orient = orient
    this.fitViewport()
    if (device === 'desktop') this.toggleCommands(false)
    // the on-screen keyboard also resizes the page: keep the view then, unless
    // the phone was turned
    this.applyToSession(changed || turned || !this.keyboardOpen())
    if (changed) this.onChange(device)
  }

  private keyboardOpen(): boolean {
    return document.documentElement.classList.contains('kbd-open')
  }

  private applyToSession(refit = true) {
    const s = this.session
    if (!s) return
    s.touch = this.device !== 'desktop'
    // landscape phones: the zoom/Cmd column on the right is kept clear
    s.fitInsetRight = this.device === 'phone' && this.orient === 'landscape' ? this.zoomBar.offsetWidth + 12 : 0
    s.setPhone(this.device === 'phone', refit)
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

  private toggleCommands(on?: boolean) {
    const opening = on ?? !this.cmds.classList.contains('open')
    if (opening && this.session) {
      const front = this.session.windows().find((w) => w.active)
      if (front && isAuto(front.title)) this.renderPage('auto')
      else if (this.page === 'auto') this.renderPage('main')
    }
    const open = this.cmds.classList.toggle('open', on)
    this.zoomBar.querySelector('[data-z="cmd"]')?.classList.toggle('on', open)
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

  /** the model's names (parameters, then variables) at the end of the strip */
  private stripNames() {
    this.keys.querySelectorAll('.name').forEach((b) => b.remove())
    for (const p of this.session?.params() ?? []) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'name'
      b.dataset.key = 'text:' + p.name
      b.textContent = p.name
      b.title = (p.ic ? 'Variable ' : 'Parameter ') + p.name
      this.keys.append(b)
    }
  }

  private showStrip(on: boolean) {
    if (on) this.stripNames()
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
