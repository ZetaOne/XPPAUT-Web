// "XPP commands": a see-through side panel with every XPP command (from
// src/commands.ts), searchable; tap one to run it, ＋ to put it on the Cmd
// panel (up to CMD_MAX; Integrate and Sliders always stay). "Edit as text" shows the Cmd
// panel's list as  Label = keys  lines. Kept per browser (src/mobile.ts).
import { COMMANDS, type XppCommand } from './commands'
import { CMD_MAX, isLocked, type MobileUI, type Shortcut } from './mobile'

const HELP = `# Your Cmd panel, one command per line:   Label = keys
# keys are XPP's menu letters:  Fit = w f   (Window/zoom, then Fit)
# AUTO window:  Two par = auto: a t      page features:  Sliders = @sliders
# Named keys: Esc Enter Tab Left Right Up Down. Up to ${CMD_MAX} lines; Integrate and Sliders always stay.
# Lines starting with # are ignored.
`

export class CommandLibrary {
  private el: HTMLElement
  private body: HTMLElement
  private search: HTMLInputElement
  private count: HTMLElement
  private text: HTMLTextAreaElement
  private problems: HTMLElement
  private mode: 'list' | 'text' = 'list'
  private ui: MobileUI
  private notice: (msg: string) => void

  constructor(ui: MobileUI, notice: (msg: string) => void) {
    this.ui = ui
    this.notice = notice
    this.el = document.createElement('aside')
    this.el.className = 'cmdlib'
    this.el.hidden = true
    this.el.setAttribute('aria-label', 'XPP commands')
    this.el.innerHTML = `
      <div class="cmdlib-head">
        <b>XPP commands</b><span class="cmdlib-count"></span>
        <button type="button" class="cmdlib-close" aria-label="Close">×</button>
      </div>
      <div class="cmdlib-tabs" role="tablist">
        <button type="button" role="tab" data-mode="list" aria-selected="true">List</button>
        <button type="button" role="tab" data-mode="text" aria-selected="false">Edit as text</button>
      </div>
      <div class="cmdlib-list">
        <input type="search" class="cmdlib-search" placeholder="Search (e.g. zoom, svg, method, w f)" aria-label="Search commands">
        <div class="cmdlib-body"></div>
      </div>
      <div class="cmdlib-text" hidden>
        <textarea spellcheck="false" aria-label="Cmd panel as text"></textarea>
        <div class="cmdlib-problems" role="alert"></div>
        <div class="cmdlib-foot">
          <button type="button" data-act="prev" title="The list as it was before the last change">Previous</button>
          <button type="button" data-act="reset">Reset to default</button>
          <button type="button" data-act="save" class="primary">Save</button>
        </div>
      </div>`
    this.body = this.el.querySelector('.cmdlib-body')!
    this.search = this.el.querySelector('.cmdlib-search')!
    this.count = this.el.querySelector('.cmdlib-count')!
    this.text = this.el.querySelector('textarea')!
    this.problems = this.el.querySelector('.cmdlib-problems')!
    this.el.querySelector('.cmdlib-close')!.addEventListener('click', () => this.close())
    this.search.addEventListener('input', () => this.render())
    for (const t of this.el.querySelectorAll<HTMLButtonElement>('[role=tab]'))
      t.addEventListener('click', () => this.setMode(t.dataset.mode as 'list' | 'text'))
    this.el.querySelector('.cmdlib-foot')!.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).dataset.act
      if (act === 'save') this.saveText()
      if (act === 'reset') this.fillText(this.ui.defaultText())
      if (act === 'prev') {
        const p = this.ui.previousText()
        if (p) this.fillText(p)
        else this.notice('No earlier version saved yet')
      }
    })
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close()
      e.stopPropagation() // typing here is not for XPP
    })
    document.body.append(this.el)
    ui.openLibrary = () => this.open()
  }

  open() {
    this.ui.toggleCommands(false)
    this.el.hidden = false
    this.setMode(this.mode)
  }

  close() {
    this.el.hidden = true
  }

  toggle() {
    if (this.el.hidden) this.open()
    else this.close()
  }

  private setMode(mode: 'list' | 'text') {
    this.mode = mode
    for (const t of this.el.querySelectorAll<HTMLButtonElement>('[role=tab]')) t.setAttribute('aria-selected', String(t.dataset.mode === mode))
    ;(this.el.querySelector('.cmdlib-list') as HTMLElement).hidden = mode !== 'list'
    ;(this.el.querySelector('.cmdlib-text') as HTMLElement).hidden = mode !== 'text'
    if (mode === 'list') this.render()
    else this.fillText(this.ui.listText())
    this.updateCount()
  }

  private updateCount() {
    this.count.textContent = `${this.ui.shortcuts().length} of ${CMD_MAX} on Cmd`
  }

  // ---- list view ----------------------------------------------------------------
  private render() {
    const q = this.search.value.trim().toLowerCase()
    const match = (label: string, keys = '', group = '') =>
      !q || label.toLowerCase().includes(q) || group.toLowerCase().includes(q) || keys.replace(/\s/g, '').startsWith(q.replace(/\s/g, ''))
    this.body.replaceChildren()
    const mine = this.ui.shortcuts()

    // 1. the Cmd panel as it is
    const own = mine.filter((c) => match(c.label, c.keys))
    if (own.length) {
      const h = this.section('Your Cmd panel')
      const reset = document.createElement('button')
      reset.type = 'button'
      reset.className = 'cmdlib-reset'
      reset.textContent = 'Reset to default'
      reset.title = 'Put back the Cmd panel as it came'
      reset.addEventListener('click', () => this.reset())
      h.append(reset)
      // reorder by dragging ⠿ (not while searching: only part of the list shows)
      const sortable = !q
      for (const c of own)
        this.row(c.label, hintOf(c), () => this.run(c), {
          remove: !isLocked(c) ? () => this.remove(c) : undefined,
          locked: isLocked(c),
          drag: sortable ? mine.indexOf(c) : undefined,
        })
    }
    // 2. the model's  @ BUT=  buttons
    const model = this.ui.modelButtons().filter((c) => match(c.label, c.keys))
    if (model.length) {
      this.section('This model (@ BUT= in the .ode)')
      for (const c of model) this.row(c.label, hintOf(c), () => this.run(c), { add: () => this.add(c), has: has(mine, c) })
    }
    // 3. page features
    const feats = this.ui.featureList().filter((f) => match(f.label, '', 'page'))
    if (feats.length) {
      this.section('Page features')
      for (const f of feats) {
        const c: Shortcut = { label: f.label, feature: f.id }
        this.row(f.label, f.hint, () => this.run(c), { add: () => this.add(c), has: has(mine, c) })
      }
    }
    // 4. every XPP command, by menu
    let group = ''
    let n = 0
    for (const c of COMMANDS) {
      if (!match(c.label, c.keys, c.group)) continue
      if (c.group !== group) this.section((group = c.group))
      const sc = fromCommand(c)
      this.row(c.label, hintOf(sc), () => this.run(c), { add: () => this.add(sc), has: has(mine, sc) })
      n++
    }
    if (!n && !own.length && !model.length && !feats.length) {
      const p = document.createElement('p')
      p.className = 'cmdlib-none'
      p.textContent = 'Nothing found. Any keys work too: add them in "Edit as text".'
      this.body.append(p)
    }
    this.updateCount()
  }

  private section(title: string): HTMLElement {
    const h = document.createElement('h4')
    h.textContent = title
    this.body.append(h)
    return h
  }

  private row(label: string, hint: string, run: () => void, o: { add?: () => void; remove?: () => void; has?: boolean; locked?: boolean; drag?: number }) {
    const r = document.createElement('div')
    r.className = 'cmdlib-row'
    if (o.drag !== undefined) {
      r.classList.add('own')
      const g = document.createElement('button')
      g.type = 'button'
      g.className = 'cmdlib-grip'
      g.textContent = '⠿'
      g.title = 'Drag up or down to change the order on the Cmd panel'
      g.setAttribute('aria-label', `Move ${label}`)
      this.dragging(g, r, o.drag)
      r.append(g)
    }
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cmdlib-run'
    b.title = 'Run it now'
    b.innerHTML = '<span></span><small></small>'
    b.querySelector('span')!.textContent = label
    b.querySelector('small')!.textContent = hint
    b.addEventListener('click', run)
    r.append(b)
    const side = document.createElement('button')
    side.type = 'button'
    side.className = 'cmdlib-side'
    if (o.locked) {
      side.textContent = '🔒'
      side.title = `${label} always stays on the Cmd panel`
      side.disabled = true
    } else if (o.remove) {
      side.textContent = '−'
      side.title = 'Remove from the Cmd panel'
      side.addEventListener('click', o.remove)
    } else if (o.has) {
      side.textContent = '✓'
      side.title = 'Already on the Cmd panel'
      side.disabled = true
    } else if (o.add) {
      side.textContent = '＋'
      side.title = 'Add to the Cmd panel'
      side.addEventListener('click', o.add)
    }
    r.append(side)
    this.body.append(r)
  }

  /** drag a row of "Your Cmd panel" by its grip to a new place in the list */
  private dragging(grip: HTMLElement, row: HTMLElement, from: number) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      grip.setPointerCapture(e.pointerId)
      const rows = [...this.body.querySelectorAll<HTMLElement>('.cmdlib-row.own')]
      const step = row.offsetHeight + 3 // row + its margin
      const y0 = e.clientY
      const s0 = this.body.scrollTop
      let to = from
      let lastY = y0
      row.classList.add('dragging')
      const place = () => {
        const dy = lastY - y0 + (this.body.scrollTop - s0)
        row.style.transform = `translateY(${dy}px)`
        to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / step)))
        rows.forEach((r, i) => {
          if (r === row) return
          const shift = from < to && i > from && i <= to ? -step : from > to && i < from && i >= to ? step : 0
          r.style.transform = shift ? `translateY(${shift}px)` : ''
        })
      }
      // near the top or bottom edge: scroll the list while dragging
      const timer = setInterval(() => {
        const box = this.body.getBoundingClientRect()
        const v = lastY < box.top + 30 ? -8 : lastY > box.bottom - 30 ? 8 : 0
        if (v) {
          this.body.scrollTop += v
          place()
        }
      }, 30)
      const move = (ev: PointerEvent) => {
        lastY = ev.clientY
        place()
      }
      const end = () => {
        clearInterval(timer)
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', end)
        grip.removeEventListener('pointercancel', end)
        for (const r of rows) r.style.transform = ''
        row.classList.remove('dragging')
        if (to === from) return
        const list = [...this.ui.shortcuts()]
        const [it] = list.splice(from, 1)
        list.splice(to, 0, it)
        this.ui.setList(list)
        this.render()
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', end)
      grip.addEventListener('pointercancel', end)
    })
  }

  private reset() {
    if (!confirm('Put the Cmd panel back as it came? (Your current list can be brought back with "Previous" in Edit as text.)')) return
    const [list] = this.ui.parseList(this.ui.defaultText())
    this.ui.setList(list)
    this.notice('Cmd panel reset to default')
    this.render()
  }

  private run(c: Shortcut | XppCommand) {
    // on a phone the panel covers XPP: get out of the way
    if (document.documentElement.dataset.device === 'phone') this.close()
    this.ui.runCommand(c)
  }

  private add(c: Shortcut) {
    const err = this.ui.setList([...this.ui.shortcuts(), c])
    if (err) return this.notice(err)
    this.notice(`Added to Cmd: ${c.label}`)
    this.render()
  }

  private remove(c: Shortcut) {
    this.ui.setList(this.ui.shortcuts().filter((x) => x !== c))
    this.render()
  }

  // ---- text view ----------------------------------------------------------------
  private fillText(list: string) {
    this.text.value = HELP + list.replace(/^#.*\n?/gm, '') + '\n'
    this.problems.textContent = ''
  }

  private saveText() {
    const [list, problems] = this.ui.parseList(this.text.value)
    if (problems.length) {
      this.problems.textContent = problems.join('\n')
      return
    }
    const err = this.ui.setList(list)
    if (err) {
      this.problems.textContent = err
      return
    }
    this.fillText(this.ui.listText())
    this.updateCount()
    this.notice(`Cmd panel saved (${list.length} commands)`)
  }
}

const same = (a: Shortcut, b: Shortcut) =>
  a.feature ? a.feature === b.feature : !b.feature && a.to === b.to && (a.keys ?? '').replace(/\s/g, '') === (b.keys ?? '').replace(/\s/g, '')
const has = (list: Shortcut[], c: Shortcut) => list.some((x) => same(x, c))
const fromCommand = (c: XppCommand): Shortcut => ({ label: c.label, keys: c.keys, to: c.to })
const hintOf = (c: Shortcut) =>
  c.feature ? '@' + c.feature : (c.to ? 'AUTO: ' : '') + (c.keys ?? '').split(' ').map((k) => (k.length > 1 ? k : k.toUpperCase())).join(' ')
