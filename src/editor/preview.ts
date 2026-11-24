// Previews of what XPP makes: images, PDF, PostScript (Ghostscript), and data
// (.dat, .csv) as a table with a plot.

export type Kind = 'text' | 'image' | 'pdf' | 'ps' | 'data' | 'binary'

const TEXT = /\.(ode|xps|set|ani|tab|txt|md|json|auto|b|d|s|c|h|log|cfg|xpprc|in|out|html|css|js)$/i

export function kindOf(name: string, data?: Uint8Array): Kind {
  const n = name.toLowerCase()
  if (/\.(png|gif|jpe?g|webp|bmp|svg)$/.test(n)) return 'image'
  if (n.endsWith('.pdf')) return 'pdf'
  if (/\.(e?ps)$/.test(n)) return 'ps'
  if (/\.(dat|csv|tsv)$/.test(n)) return 'data'
  if (TEXT.test(n) || !/\.[a-z0-9]+$/.test(n)) return 'text'
  // unknown: text when it looks like text
  if (data && !data.subarray(0, 2000).some((b) => b === 0)) return 'text'
  return 'binary'
}

const mime = (name: string) => {
  const n = name.toLowerCase()
  if (n.endsWith('.svg')) return 'image/svg+xml'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.gif')) return 'image/gif'
  if (/\.jpe?g$/.test(n)) return 'image/jpeg'
  if (n.endsWith('.webp')) return 'image/webp'
  if (n.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

export interface Preview {
  el: HTMLElement
  dispose(): void
}

/** a zoomable image (wheel / pinch with ctrl, or the + − buttons) */
function zoomable(urls: string[], label: string, extra?: HTMLElement): Preview {
  const el = document.createElement('div')
  el.className = 'pv'
  const bar = document.createElement('div')
  bar.className = 'pv-bar'
  bar.innerHTML = `<span>${label}</span><button type="button" data-z="-">−</button><button type="button" data-z="fit">Fit</button><button type="button" data-z="1">100%</button><button type="button" data-z="+">+</button>`
  if (extra) bar.append(extra)
  const stage = document.createElement('div')
  stage.className = 'pv-stage'
  let z = 0 // 0: fit
  const imgs = urls.map((u) => {
    const i = new Image()
    i.src = u
    i.className = 'pv-img fit'
    stage.append(i)
    return i
  })
  const apply = () => {
    for (const i of imgs) {
      i.style.width = z ? i.naturalWidth * z + 'px' : ''
      i.classList.toggle('fit', !z)
    }
  }
  bar.addEventListener('click', (e) => {
    const k = (e.target as HTMLElement).dataset.z
    if (!k) return
    const cur = z || (imgs[0] ? imgs[0].clientWidth / (imgs[0].naturalWidth || 1) : 1)
    z = k === 'fit' ? 0 : k === '1' ? 1 : Math.min(8, Math.max(0.1, cur * (k === '+' ? 1.25 : 0.8)))
    apply()
  })
  stage.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const cur = z || (imgs[0] ? imgs[0].clientWidth / (imgs[0].naturalWidth || 1) : 1)
      z = Math.min(8, Math.max(0.1, cur * (e.deltaY < 0 ? 1.1 : 0.9)))
      apply()
    },
    { passive: false },
  )
  el.append(bar, stage)
  return { el, dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)) }
}

export function imagePreview(name: string, data: Uint8Array): Preview {
  return zoomable([URL.createObjectURL(new Blob([data as BlobPart], { type: mime(name) }))], name)
}

export function pdfPreview(name: string, data: Uint8Array): Preview {
  const el = document.createElement('div')
  el.className = 'pv'
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }))
  const f = document.createElement('iframe')
  f.className = 'pv-pdf'
  f.src = url
  f.title = name
  el.append(f)
  return { el, dispose: () => URL.revokeObjectURL(url) }
}

let gsBusy: Promise<unknown> = Promise.resolve()
/** PostScript through Ghostscript (about 16 MB, downloaded the first time) */
export function psPreview(name: string, data: Uint8Array): Preview {
  const el = document.createElement('div')
  el.className = 'pv'
  el.innerHTML = '<p class="pv-wait">Drawing the PostScript with Ghostscript (the first time it downloads about 16 MB, then it is kept)…</p>'
  let inner: Preview | null = null
  let gone = false
  gsBusy = gsBusy.then(
    () =>
      new Promise<void>((done) => {
        const w = new Worker(new URL('./gs-worker.ts', import.meta.url), { type: 'module' })
        w.onmessage = (e: MessageEvent<{ pages: Uint8Array[]; log: string }>) => {
          w.terminate()
          done()
          if (gone) return
          el.replaceChildren()
          if (!e.data.pages.length) {
            el.innerHTML = '<p class="pv-wait">Ghostscript could not draw this file.</p><pre class="pv-log"></pre>'
            el.querySelector('pre')!.textContent = e.data.log
            return
          }
          const note = document.createElement('a')
          note.href = 'https://ghostscript.com/releases/gsdnld.html'
          note.target = '_blank'
          note.rel = 'noopener'
          note.className = 'pv-note'
          note.textContent = 'Drawn by Ghostscript (AGPL-3.0, source)'
          const png = document.createElement('button')
          png.type = 'button'
          png.textContent = 'Save as PNG'
          png.addEventListener('click', () => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([e.data.pages[0] as BlobPart], { type: 'image/png' }))
            a.download = name.replace(/\.e?ps$/i, '') + '.png'
            a.click()
          })
          const extra = document.createElement('span')
          extra.className = 'pv-extra'
          extra.append(png, note)
          inner = zoomable(
            e.data.pages.map((p) => URL.createObjectURL(new Blob([p as BlobPart], { type: 'image/png' }))),
            `${name} (${e.data.pages.length} page${e.data.pages.length > 1 ? 's' : ''})`,
            extra,
          )
          el.append(...inner.el.childNodes)
        }
        w.onerror = (err) => {
          w.terminate()
          done()
          el.innerHTML = '<p class="pv-wait"></p>'
          el.querySelector('p')!.textContent = 'Ghostscript could not start: ' + (err.message || 'unknown error')
        }
        w.postMessage({ ps: data, dpi: 110 })
      }),
  )
  return {
    el,
    dispose: () => {
      gone = true
      inner?.dispose()
    },
  }
}

/** numbers in columns (XPP's .dat: spaces; .csv: commas); a header row if
 *  the first line is not numbers */
export function parseData(text: string): { names: string[]; rows: number[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'))
  const split = (l: string) => l.trim().split(/[\s,;\t]+/)
  let names: string[] = []
  if (lines.length && split(lines[0]).some((x) => isNaN(Number(x)))) names = split(lines.shift()!)
  const rows = lines.map((l) => split(l).map(Number)).filter((r) => r.some((x) => !isNaN(x)))
  const n = Math.max(names.length, ...rows.slice(0, 50).map((r) => r.length), 0)
  while (names.length < n) names.push(names.length === 0 ? 't' : 'col ' + (names.length + 1))
  return { names, rows }
}

export function dataPreview(name: string, text: string, colours: string[]): Preview {
  const { names, rows } = parseData(text)
  const el = document.createElement('div')
  el.className = 'pv pv-data'
  if (!rows.length) {
    el.innerHTML = '<p class="pv-wait">No numbers found in this file.</p>'
    return { el, dispose: () => {} }
  }
  const bar = document.createElement('div')
  bar.className = 'pv-bar'
  bar.innerHTML = `<span>${name}: ${rows.length} rows, ${names.length} columns</span><label>x <select class="pv-x"></select></label><span class="pv-cols"></span>`
  const xs = bar.querySelector<HTMLSelectElement>('.pv-x')!
  names.forEach((n, i) => xs.append(new Option(n, String(i))))
  const shown = new Set<number>(names.map((_, i) => i).filter((i) => i > 0).slice(0, 4))
  const cols = bar.querySelector('.pv-cols')!
  names.forEach((n, i) => {
    if (i === 0 && names.length > 1) return
    const l = document.createElement('label')
    l.className = 'pv-col'
    l.innerHTML = `<input type="checkbox"${shown.has(i) ? ' checked' : ''}> <i style="background:${colours[i % colours.length]}"></i>`
    l.append(n)
    l.querySelector('input')!.addEventListener('change', (e) => {
      if ((e.target as HTMLInputElement).checked) shown.add(i)
      else shown.delete(i)
      draw()
    })
    cols.append(l)
  })
  const canvas = document.createElement('canvas')
  canvas.className = 'pv-plot'
  const table = document.createElement('div')
  table.className = 'pv-table'
  const max = 500
  table.innerHTML =
    '<table><thead><tr>' + names.map((n) => `<th>${n.replace(/</g, '&lt;')}</th>`).join('') + '</tr></thead><tbody>' +
    rows.slice(0, max).map((r) => '<tr>' + r.map((v) => `<td>${isNaN(v) ? '' : +v.toPrecision(7)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table>' + (rows.length > max ? `<p class="pv-wait">first ${max} of ${rows.length} rows</p>` : '')
  const draw = () => {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    const style = getComputedStyle(el)
    g.clearRect(0, 0, w, h)
    const xi = Number(xs.value)
    const ys = [...shown].filter((i) => i !== xi)
    const X = rows.map((r) => r[xi])
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const r of rows) {
      if (isFinite(r[xi])) (x0 = Math.min(x0, r[xi])), (x1 = Math.max(x1, r[xi]))
      for (const i of ys) if (isFinite(r[i])) (y0 = Math.min(y0, r[i])), (y1 = Math.max(y1, r[i]))
    }
    if (!isFinite(x0) || !isFinite(y0)) return
    if (x1 === x0) x1 = x0 + 1
    if (y1 === y0) (y1 = y0 + 1), (y0 -= 1)
    const L = 54, R = 12, T = 10, B = 28
    const px = (x: number) => L + ((x - x0) / (x1 - x0)) * (w - L - R)
    const py = (y: number) => h - B - ((y - y0) / (y1 - y0)) * (h - T - B)
    g.strokeStyle = style.getPropertyValue('--ed-line') || '#888'
    g.fillStyle = style.color
    g.font = '11px system-ui, sans-serif'
    g.strokeRect(L, T, w - L - R, h - T - B)
    for (let k = 0; k <= 4; k++) {
      const xv = x0 + ((x1 - x0) * k) / 4
      const yv = y0 + ((y1 - y0) * k) / 4
      g.fillText(String(+xv.toPrecision(4)), px(xv) - 12, h - 10)
      g.fillText(String(+yv.toPrecision(4)), 4, py(yv) + 4)
    }
    for (const i of ys) {
      g.strokeStyle = colours[i % colours.length]
      g.lineWidth = 1.4
      g.beginPath()
      let up = false
      rows.forEach((r, k) => {
        const y = r[i]
        if (!isFinite(y) || !isFinite(X[k])) return (up = false)
        if (up) g.lineTo(px(X[k]), py(y))
        else g.moveTo(px(X[k]), py(y))
        up = true
      })
      g.stroke()
    }
  }
  xs.addEventListener('change', draw)
  const ro = new ResizeObserver(draw)
  ro.observe(canvas)
  el.append(bar, canvas, table)
  return { el, dispose: () => ro.disconnect() }
}
