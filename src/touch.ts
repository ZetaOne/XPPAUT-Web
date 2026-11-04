// Touch helpers around XPP's windows (phones and tablets only):
//  - a loupe: holding a finger on a window magnifies what is under it and,
//    over the graph, shows XPP's coordinates there;
//  - a slider drawer: large sliders for parameters, which drive XPP's own
//    three Par/Var sliders (so XPP re-runs the integration itself).
// XPP's windows are not changed; these are page elements over them.
import type { XppSession } from './xpp'

const fmt = (v: number) => (Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : String(+v.toPrecision(5)))

// ---- loupe ------------------------------------------------------------------

export class Loupe {
  private el: HTMLElement
  private lens: HTMLCanvasElement
  private label: HTMLElement
  private finger: { id: number; timer: number; on: boolean; canvas: HTMLCanvasElement } | null = null
  enabled = () => true
  private session: () => XppSession | null

  constructor(desktop: HTMLElement, session: () => XppSession | null) {
    this.session = session
    this.el = document.createElement('div')
    this.el.className = 'loupe'
    this.el.hidden = true
    this.el.setAttribute('aria-hidden', 'true')
    this.lens = document.createElement('canvas')
    this.lens.width = this.lens.height = 120
    this.label = document.createElement('div')
    this.label.className = 'loupe-xy'
    this.el.append(this.lens, this.label)
    document.body.append(this.el)

    // listen only (capture, passive): XPP's own touch handling is unchanged
    const opts = { capture: true, passive: true }
    desktop.addEventListener('pointerdown', (e) => this.down(e), opts)
    desktop.addEventListener('pointermove', (e) => this.move(e), opts)
    desktop.addEventListener('pointerup', (e) => this.up(e), opts)
    desktop.addEventListener('pointercancel', (e) => this.up(e), opts)
  }

  private down(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !this.enabled()) return
    const c = e.target as HTMLElement
    if (this.finger || !(c instanceof HTMLCanvasElement) || !c.closest('.xwin')) {
      this.hide() // a second finger: pinch or pan
      return
    }
    const id = e.pointerId
    const [x, y] = [e.clientX, e.clientY]
    this.finger = {
      id, canvas: c, on: false,
      // a short hold shows it; a quick tap does not
      timer: window.setTimeout(() => {
        if (this.finger?.id !== id) return
        this.finger.on = true
        this.show(x, y)
      }, 220),
    }
  }

  private move(e: PointerEvent) {
    if (!this.finger || e.pointerId !== this.finger.id) return
    if (this.finger.on) this.show(e.clientX, e.clientY)
  }

  private up(e: PointerEvent) {
    if (!this.finger || e.pointerId !== this.finger.id) return
    clearTimeout(this.finger.timer)
    this.finger = null
    this.hide()
  }

  private hide() {
    if (this.finger) clearTimeout(this.finger.timer)
    this.finger = null
    this.el.hidden = true
  }

  private show(cx: number, cy: number) {
    const c = this.finger!.canvas
    const r = c.getBoundingClientRect()
    // canvas pixels under the finger, magnified 3x (pixelated: XPP's look)
    const px = ((cx - r.left) * c.width) / r.width
    const py = ((cy - r.top) * c.height) / r.height
    const g = this.lens.getContext('2d')!
    const span = this.lens.width / 3
    g.imageSmoothingEnabled = false
    g.fillStyle = '#fff'
    g.fillRect(0, 0, this.lens.width, this.lens.height)
    g.drawImage(c, px - span / 2, py - span / 2, span, span, 0, 0, this.lens.width, this.lens.height)
    // cross-hair at the point the finger touches
    g.strokeStyle = 'rgb(220 0 0 / 0.8)'
    g.lineWidth = 1
    g.beginPath()
    g.moveTo(60.5, 48)
    g.lineTo(60.5, 72)
    g.moveTo(48, 60.5)
    g.lineTo(72, 60.5)
    g.stroke()
    const xy = this.session()?.graphAt(cx, cy)
    this.label.textContent = xy ? `${xy.xname} = ${fmt(xy.x)}   ${xy.yname} = ${fmt(xy.y)}` : ''
    this.label.hidden = !xy
    // above the finger (below it near the top of the screen)
    const above = cy - 190 > 0
    this.el.style.left = Math.min(window.innerWidth - 136, Math.max(8, cx - 64)) + 'px'
    this.el.style.top = (above ? cy - 190 : cy + 50) + 'px'
    this.el.hidden = false
  }
}

// ---- slider drawer ------------------------------------------------------------

interface Row {
  k: number
  name: HTMLSelectElement
  lo: HTMLInputElement
  hi: HTMLInputElement
  range: HTMLInputElement
  value: HTMLOutputElement
  play: HTMLButtonElement
  ready: boolean // XPP's slider k is set up for this row
}

export class SliderDrawer {
  readonly el: HTMLElement
  private rows: Row[] = []
  private pending = new Map<number, number>()
  private playing: { row: Row; dir: number } | null = null
  private session: () => XppSession | null
  private tip: (m: string) => void

  constructor(parent: HTMLElement, session: () => XppSession | null, tip: (m: string) => void) {
    this.session = session
    this.tip = tip
    this.el = document.createElement('div')
    this.el.className = 'sliders'
    this.el.hidden = true
    this.el.innerHTML = `<div class="sliders-head"><b>Sliders</b>
      <span>XPP's three Par/Var sliders: XPP re-runs the model as you move one</span>
      <button type="button" class="sliders-close" aria-label="Close">×</button></div>`
    this.el.querySelector('.sliders-close')!.addEventListener('click', () => this.toggle(false))
    for (let k = 0; k < 3; k++) this.rows.push(this.makeRow(k))
    parent.append(this.el)
    // apply the latest value whenever XPP is free (one run at a time)
    setInterval(() => this.flush(), 120)
  }

  get open() {
    return !this.el.hidden
  }

  toggle(on = this.el.hidden) {
    this.el.hidden = !on
    if (on) this.refresh()
    else this.stopPlay()
    return on
  }

  private makeRow(k: number): Row {
    const d = document.createElement('div')
    d.className = 'slider-row'
    d.innerHTML = `<select aria-label="Parameter or variable"></select>
      <input type="number" class="lo" aria-label="Low" step="any">
      <input type="range" class="range" aria-label="Value" min="0" max="100" step="1">
      <input type="number" class="hi" aria-label="High" step="any">
      <output></output>
      <button type="button" class="play" aria-label="Play">▶</button>`
    const row: Row = {
      k, ready: false,
      name: d.querySelector('select')!,
      lo: d.querySelector('.lo')!,
      hi: d.querySelector('.hi')!,
      range: d.querySelector('.range')!,
      value: d.querySelector('output')!,
      play: d.querySelector('.play')!,
    }
    row.name.addEventListener('change', () => this.choose(row))
    row.lo.addEventListener('change', () => this.rebound(row))
    row.hi.addEventListener('change', () => this.rebound(row))
    row.range.addEventListener('input', () => this.slid(row))
    row.play.addEventListener('click', () => (this.playing?.row === row ? this.stopPlay() : this.startPlay(row)))
    this.el.append(d)
    return row
  }

  /** fill the rows from the model and from XPP's sliders */
  refresh() {
    const s = this.session()
    if (!s) return
    const params = s.params()
    for (const row of this.rows) {
      const info = s.sliderInfo(row.k)
      const keep = info?.name ?? row.name.value
      row.name.innerHTML = '<option value="">(choose)</option>'
      const groups: Array<[string, boolean]> = [['Parameters', false], ['Initial values', true]]
      for (const [label, ic] of groups) {
        const og = document.createElement('optgroup')
        og.label = label
        for (const p of params.filter((q) => q.ic === ic)) og.append(new Option(p.name, p.name))
        if (og.children.length) row.name.append(og)
      }
      row.name.value = keep
      if (info) {
        row.lo.value = String(info.lo)
        row.hi.value = String(info.hi)
        this.setRange(row, info.value)
        row.ready = true
      } else row.ready = false
      this.enable(row)
    }
  }

  private enable(row: Row) {
    const on = !!row.name.value
    for (const e of [row.lo, row.hi, row.range, row.play]) e.disabled = !on
    if (!on) row.value.textContent = ''
  }

  private setRange(row: Row, v: number) {
    const s = this.session()
    const steps = s ? s.sliderSteps(row.k) : 100
    const [lo, hi] = [+row.lo.value, +row.hi.value]
    row.range.max = String(steps)
    row.range.value = String(Math.round(((v - lo) / (hi - lo || 1)) * steps))
    row.value.textContent = fmt(v)
  }

  private choose(row: Row) {
    this.enable(row)
    row.ready = false
    if (!row.name.value) return
    const p = this.session()?.params().find((q) => q.name === row.name.value)
    if (!p) return
    const v = p.value
    const span = v === 0 ? 1 : Math.abs(v)
    row.lo.value = String(+(v - span).toPrecision(6))
    row.hi.value = String(+(v + span).toPrecision(6))
    void this.setup(row, v)
  }

  private rebound(row: Row) {
    const [lo, hi] = [+row.lo.value, +row.hi.value]
    if (!(hi > lo)) return this.tip('Low must be below High')
    const cur = Number(row.value.textContent) || lo
    void this.setup(row, Math.min(hi, Math.max(lo, cur)))
  }

  private async setup(row: Row, v: number) {
    const s = this.session()
    if (!s) return
    row.ready = await s.setupSlider(row.k, row.name.value, +row.lo.value, +row.hi.value, v)
    if (!row.ready) return this.tip(`XPP could not use ${row.name.value} on a slider`)
    this.setRange(row, v)
  }

  private value(row: Row): number {
    const [lo, hi] = [+row.lo.value, +row.hi.value]
    return lo + ((hi - lo) * +row.range.value) / +row.range.max
  }

  private slid(row: Row) {
    if (!row.ready) return
    const v = this.value(row)
    row.value.textContent = fmt(v)
    this.pending.set(row.k, v)
  }

  private flush() {
    const s = this.session()
    if (!s || s.busy) return
    if (this.playing) this.stepPlay()
    for (const [k, v] of this.pending) {
      this.pending.delete(k)
      s.moveSlider(k, v)
      return // one run at a time
    }
  }

  private startPlay(row: Row) {
    if (!row.ready) return
    this.stopPlay()
    this.playing = { row, dir: 1 }
    row.play.textContent = '⏸'
    row.play.setAttribute('aria-label', 'Pause')
  }

  private stopPlay() {
    if (!this.playing) return
    this.playing.row.play.textContent = '▶'
    this.playing.row.play.setAttribute('aria-label', 'Play')
    this.playing = null
  }

  /** Play: sweep low -> high -> low, one XPP run per step (~40 steps) */
  private stepPlay() {
    const p = this.playing!
    const max = +p.row.range.max
    const step = Math.max(1, Math.round(max / 40))
    let v = +p.row.range.value + p.dir * step
    if (v >= max || v <= 0) {
      v = Math.min(max, Math.max(0, v))
      p.dir = -p.dir
    }
    p.row.range.value = String(v)
    this.slid(p.row)
  }
}
