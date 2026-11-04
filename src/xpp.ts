// Runs XPPAUT (WebAssembly) in the page and acts as its window manager:
// every top-level X window becomes a draggable panel holding a <canvas>, and
// any panel can be popped out into its own browser window.
// See web/xlib/platform_web.c for the C side of these hooks.

import { download } from './zip';

/* eslint-disable @typescript-eslint/no-explicit-any */
type XppModule = any;

const TITLE_H = 22;

// X11 constants
const ShiftMask = 1 << 0;
const LockMask = 1 << 1;
const ControlMask = 1 << 2;
const Mod1Mask = 1 << 3;
const Button1Mask = 1 << 8;

const SPECIAL_KEYS: Record<string, [number, string]> = {
  Enter: [0xff0d, '\r'],
  Escape: [0xff1b, '\x1b'],
  Backspace: [0xff08, '\b'],
  Tab: [0xff09, '\t'],
  Delete: [0xffff, '\x7f'],
  ArrowLeft: [0xff51, ''],
  ArrowUp: [0xff52, ''],
  ArrowRight: [0xff53, ''],
  ArrowDown: [0xff54, ''],
  Home: [0xff50, ''],
  End: [0xff57, ''],
  PageUp: [0xff55, ''],
  PageDown: [0xff56, ''],
  Insert: [0xff63, ''],
};
for (let i = 1; i <= 12; i++) SPECIAL_KEYS['F' + i] = [0xffbe + i - 1, ''];

// X font cursor shape (id - 1) -> CSS cursor
const CURSORS: Record<number, string> = { 60: 'pointer', 152: 'text', 34: 'crosshair', 68: 'default' };

// PointerEvent.buttons bit -> X button number (left, right, middle)
const BUTTON_BITS: Array<[number, number]> = [[1, 1], [2, 3], [4, 2]];

interface Panel {
  id: number;
  el: HTMLDivElement;
  title: HTMLSpanElement;
  canvas: HTMLCanvasElement;
  grip: HTMLDivElement;
  ctx: CanvasRenderingContext2D;
  placed: boolean;
  mapped: boolean;
  x: number; // XPP's idea of the window's position (root coordinates)
  y: number;
  popup: Window | null; // separate browser window, when popped out
}

/** Which WebAssembly build this browser should run: JSPI where the engine
    supports it (native speed), else Asyncify. ?engine=asyncify forces one. */
export function xppBuild(): { engine: 'jspi' | 'asyncify'; dir: string } {
  const forced = new URLSearchParams(location.search).get('engine');
  const jspi = forced ? forced === 'jspi' : 'Suspending' in WebAssembly;
  return jspi ? { engine: 'jspi', dir: 'wasm/jspi/' } : { engine: 'asyncify', dir: 'wasm/' };
}

export interface WindowImage {
  title: string;
  x: number;
  y: number;
  canvas: HTMLCanvasElement;
}

export interface XppCallbacks {
  onOutput?: (line: string) => void;
  onExit?: (status: number) => void;
  onNotice?: (message: string) => void;
  /** XPP finished writing a file (an export). `path` is where it lives in
      XPP's virtual file system: its dialog can browse to other folders. */
  onFileWritten?: (path: string) => void;
}

export class XppSession {
  /** Open XPP's new windows (other than the main one) as browser windows. */
  popOutNew = false;
  /** Which build is running: 'jspi' (fast) or 'asyncify'. */
  engine = '';
  /** True while XPP computes (it polls for input); false while it waits. */
  busy = false;

  private mod: XppModule;
  private panels = new Map<number, Panel>();
  private input: Array<() => void> = [];
  private infoPtr = 0;
  private listPtr = 0;
  private sizePtr = 0;
  private zTop = 10;
  private buttons = 0; // X button state mask
  private needSync = true;
  private cascade = 0;
  /** XPP is running (has not quit) */
  running = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private mainId = 0;

  private desktop: HTMLElement;
  private cb: XppCallbacks;
  /** layer holding the panels; zoomed and panned on touch devices */
  private world: HTMLDivElement;
  private view = { s: 1, tx: 0, ty: 0 };
  private activeId = 0;
  private touches = new Map<number, { x: number; y: number }>();
  private gesture: { d0: number; mx: number; my: number; s0: number; tx0: number; ty0: number } | null = null;
  /** phone layout: only the active window is shown, fitted to the screen */
  private phone = false;
  /** touch input (tap / long-press / drag gestures) */
  touch = false;
  /** called when windows open, close, retitle or the active one changes */
  onWindowsChanged: () => void = () => {};

  constructor(desktop: HTMLElement, cb: XppCallbacks = {}) {
    this.desktop = desktop;
    this.cb = cb;
    this.world = document.createElement('div');
    this.world.className = 'world';
    desktop.append(this.world);
    this.installGestures();
  }

  // ---- view: zoom and pan (touch devices) ---------------------------------

  getView(): { s: number; tx: number; ty: number } {
    return { ...this.view };
  }

  setView(s: number, tx: number, ty: number): void {
    this.view = { s: Math.min(4, Math.max(0.25, s)), tx, ty };
    this.world.style.transform =
      this.view.s === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${this.view.s})`;
  }

  /** room on the right of the desktop kept free of the window (touch
   *  controls in landscape), in CSS pixels */
  fitInsetRight = 0;

  /** zoom so that window id (default: the active one) fills the desktop */
  fit(id = this.activeId): void {
    const p = this.panels.get(id);
    if (!p || p.popup) return;
    const W = this.desktop.clientWidth - this.fitInsetRight;
    const H = this.desktop.clientHeight;
    const w = p.el.offsetWidth + 2; // panel size: title bar height varies (touch)
    const h = p.el.offsetHeight + 2;
    // phones held upright: fit the width (readable; pan up/down with two
    // fingers); otherwise (landscape, tablets) fit the whole window
    const widthOnly = this.phone && H > W;
    const s = Math.min(4, Math.max(0.25, widthOnly ? (W - 4) / w : Math.min((W - 8) / w, (H - 8) / h)));
    const top = widthOnly ? 4 : Math.max(4, Math.round((H - h * s) / 2));
    this.setView(s, Math.round((W - w * s) / 2 - (p.el.offsetLeft - 1) * s), Math.round(top - (p.el.offsetTop - 1) * s));
  }

  /** XPP's main window (where most keyboard commands go) */
  get mainWindow(): number {
    return this.mainId;
  }

  /** two fingers tapped (no pinch or pan): used as Esc on touch devices */
  onTwoFingerTap: () => void = () => {};
  /** bumped whenever a second finger touches, to cancel one-finger taps */
  private multiTouchSeq = 0;

  /** open XPP windows (mapped), for the phone tab bar */
  windows(): Array<{ id: number; title: string; active: boolean }> {
    return [...this.panels.values()]
      .filter((p) => p.mapped && !(this.phone && this.isNote(p)))
      .map((p) => ({ id: p.id, title: p.title.textContent || 'XPP', active: p.id === this.activeId }));
  }

  /** bring a window to the front (and, on phones, to the screen) */
  activate(id: number): void {
    const p = this.panels.get(id);
    if (p) this.raise(p);
  }

  setPhone(on: boolean, refit = true): void {
    this.phone = on;
    this.applyPhone();
    if (on && refit) this.fit();
  }

  /** XPP's small message box ("Yo!", e.g. "Click on initial data -- ESC to
   *  quit"): on phones it floats over the window it is about, instead of
   *  taking the screen */
  private isNote(p: Panel): boolean {
    return p.title.textContent === 'Yo!';
  }

  private applyPhone(): void {
    for (const p of this.panels.values()) {
      const note = this.phone && this.isNote(p);
      p.el.classList.toggle('offstage', this.phone && !note && p.id !== this.activeId);
      p.el.classList.toggle('note-float', note);
      // outside the zoomed layer, so it stays put at the top of the screen
      const home = note ? this.desktop : this.world;
      if (p.el.parentElement !== home) home.append(p.el);
    }
  }

  // ---- touch controls: read and set XPP state (web/xlib/xpp_hooks.c) ------

  /** XPP's graph coordinates under a page point, if it is over the graph */
  graphAt(clientX: number, clientY: number): { x: number; y: number; xname: string; yname: string } | null {
    const m = this.mod;
    if (!m) return null;
    for (const p of this.panels.values()) {
      if (!p.mapped || p.popup || p.el.classList.contains('offstage')) continue;
      const r = p.canvas.getBoundingClientRect();
      if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) continue;
      const [rx, ry] = this.rootXY(p, { clientX, clientY });
      const buf = m._malloc(16 + 64);
      try {
        if (!m._xw_graph_xy(rx, ry, buf, buf + 16, 64)) return null;
        const f = new Float64Array(m.HEAPU8.buffer, buf, 2);
        const [xname, yname] = m.UTF8ToString(buf + 16).split('\t');
        return { x: f[0], y: f[1], xname, yname };
      } finally {
        m._free(buf);
      }
    }
    return null;
  }

  /** the model's parameters, then its variables (initial values) */
  params(): Array<{ name: string; value: number; ic: boolean }> {
    const m = this.mod;
    if (!m) return [];
    const n = 64 * 1024;
    const buf = m._malloc(n);
    try {
      m._xw_params(buf, n);
      return m.UTF8ToString(buf).split('\n').filter(Boolean).map((l: string) => {
        const ic = l.startsWith('@');
        const [name, v] = (ic ? l.slice(1) : l).split('=');
        return { name, value: Number(v), ic };
      });
    } finally {
      m._free(buf);
    }
  }

  /** what XPP's Par/Var slider k (0-2) is set to */
  sliderInfo(k: number): { name: string; value: number; lo: number; hi: number } | null {
    const m = this.mod;
    if (!m) return null;
    const buf = m._malloc(32 + 32);
    try {
      m._xw_slider_info(k, buf, buf + 32, 32);
      const f = new Float64Array(m.HEAPU8.buffer, buf, 4);
      return f[0] ? { name: m.UTF8ToString(buf + 32), value: f[1], lo: f[2], hi: f[3] } : null;
    } finally {
      m._free(buf);
    }
  }

  /** set up XPP's slider k for a parameter (as its "Set Sliders" dialog) */
  setupSlider(k: number, name: string, lo: number, hi: number, value: number): Promise<boolean> {
    return new Promise((resolve) =>
      this.queue(() => {
        const m = this.mod;
        const buf = m._malloc(16 + 32);
        m.stringToUTF8(name, buf + 16, 32);
        const ok = !!m._xw_slider_setup(k, buf + 16, lo, hi, value, buf);
        m._free(buf);
        resolve(ok);
      }),
    );
  }

  /** XPP's slider k: where its slide is (root coordinates) and its length */
  private sliderWhere(k: number): { x: number; y: number; l: number; h: number } | null {
    const m = this.mod;
    const buf = m._malloc(16);
    try {
      if (!m._xw_slider_where(k, buf)) return null;
      const [x, y, l, h] = new Int32Array(m.HEAPU8.buffer, buf, 4);
      return { x, y, l, h };
    } finally {
      m._free(buf);
    }
  }

  /** the slider positions XPP's slider k can take (its value steps) */
  sliderSteps(k: number): number {
    const w = this.mod ? this.sliderWhere(k) : null;
    return w ? Math.max(1, w.l - 4) : 100;
  }

  /**
   * Move XPP's slider k to `value` with a press, drag and release on it, so
   * XPP sets the parameter and re-runs the integration itself, as when the
   * slider is dragged with a mouse. The value is rounded to the slider's
   * steps; returns the value XPP uses.
   */
  moveSlider(k: number, value: number): number | null {
    const info = this.sliderInfo(k);
    const w = info && this.sliderWhere(k);
    if (!info || !w) return null;
    const steps = Math.max(1, w.l - 4);
    const pos = 2 + Math.round(Math.min(1, Math.max(0, (value - info.lo) / (info.hi - info.lo))) * steps);
    const [x, y] = [w.x + pos, w.y + (w.h >> 1)];
    this.queue(() => {
      this.mod._xw_input_motion(x, y, 0);
      this.mod._xw_input_button(x, y, 1, 1, 0);
      this.mod._xw_input_motion(x, y, Button1Mask);
      this.mod._xw_input_button(x, y, 1, 0, Button1Mask);
    });
    return info.lo + ((info.hi - info.lo) * (pos - 2)) / steps;
  }

  /** set a parameter, or a variable's initial value (ic) */
  setValue(name: string, value: number, ic: boolean): void {
    this.queue(() => {
      const m = this.mod;
      const buf = m._malloc(64);
      m.stringToUTF8(name, buf, 64);
      m._xw_set_value(buf, value, ic ? 1 : 0);
      m._free(buf);
    });
  }

  /** write XPP's data (as in its Data Viewer) as CSV; resolves to the rows */
  writeCsv(path: string): Promise<number> {
    return new Promise((resolve) =>
      this.queue(() => {
        const m = this.mod;
        const buf = m._malloc(path.length * 4 + 1);
        m.stringToUTF8(path, buf, path.length * 4 + 1);
        resolve(m._xw_write_csv(buf));
        m._free(buf);
      }),
    );
  }

  /** a key from the on-screen key strip or keyboard ('Escape', 'a', ...) */
  pressKey(key: string, ctrl = false): void {
    const [ks, text] = SPECIAL_KEYS[key] ?? [key.codePointAt(0)! < 0x100 ? key.codePointAt(0)! : 0x01000000 + key.codePointAt(0)!, key];
    const m = this.mod;
    if (!m) return;
    const state = ctrl ? ControlMask : 0;
    for (const press of [1, 0])
      this.queue(() => {
        const buf = m._malloc(16);
        m.stringToUTF8(text, buf, 16);
        m._xw_input_key(ks, buf, press, state);
        m._free(buf);
      });
  }

  /** Start XPP on an .ode file (plus extra files, e.g. .ani or .tab, put
      next to it). Resolves once XPP is running. */
  async start(
    fileName: string,
    contents: string,
    extras: Array<{ name: string; data: Uint8Array }> = [],
    wasmBinary?: ArrayBuffer, // already downloaded (with progress) by the page
  ): Promise<void> {
    // JSPI build where the engine supports it (native speed), else Asyncify
    const { engine, dir } = xppBuild();
    this.engine = engine;
    const url = new URL(dir + 'xppaut.mjs', document.baseURI).href;
    const { default: createXpp } = await import(/* @vite-ignore */ url);
    const out = (s: string) => this.cb.onOutput?.(s);
    this.mod = await createXpp({
      noInitialRun: true,
      // XPP keeps AUTO's output (.b/.d/.s) and reads .xpprc in $HOME: make
      // that the working folder so they show up in (and come from) Files
      preRun: [(mod: XppModule) => {
        mod.ENV.HOME = '/work';
      }],
      locateFile: (p: string) => new URL(dir + p, document.baseURI).href,
      // use the bytes the page already downloaded instead of fetching again
      ...(wasmBinary
        ? {
            instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
              WebAssembly.instantiate(wasmBinary, imports).then((r) => done(r.instance, r.module));
              return {};
            },
          }
        : {}),
      print: out,
      printErr: out,
      onExit: (status: number) => this.exited(status),
      xppPresent: () => this.present(),
      xppDrainInput: () => this.drainInput(),
      xppToplevelChanged: () => {
        this.needSync = true;
      },
      xppCursor: (w: number, shape: number) => this.setCursor(w, shape),
      xppBell: () => this.bell(),
      xppFileWritten: (path: string) => {
        this.cb.onFileWritten?.(path.replace(/\/{2,}/g, '/'));
      },
      xppOpenHelp: () => {
        const w = window.open(new URL('help/xpphelp.html', document.baseURI).href, 'xpp-help');
        if (!w) this.cb.onNotice?.('Pop-up blocked: XPP help is at help/xpphelp.html');
      },
      xppBusy: (b: number) => {
        this.busy = !!b;
      },
      xppScreenWidth: () => this.desktop.clientWidth,
      xppScreenHeight: () => this.desktop.clientHeight,
    });
    const m = this.mod;
    this.infoPtr = m._malloc(5 * 4);
    this.listPtr = m._malloc(256 * 4);
    this.sizePtr = m._malloc(2 * 4);
    try {
      m.FS.mkdir('/work');
    } catch {
      /* exists */
    }
    m.FS.chdir('/work');
    for (const f of extras) m.FS.writeFile('/work/' + f.name, f.data);
    m.FS.writeFile('/work/' + fileName, contents);
    this.odeName = fileName;
    this.installKeyboard(window);
    window.addEventListener('pagehide', () => {
      for (const p of this.panels.values()) p.popup?.close();
    });
    this.running = true;
    const isExit = (e: unknown) => e && (e as any).name === 'ExitStatus';
    try {
      const r = m.callMain([fileName]); // returns a Promise with JSPI
      if (r && typeof r.then === 'function')
        r.catch((e: unknown) => {
          if (!isExit(e)) throw e;
        });
    } catch (e) {
      if (!isExit(e)) throw e;
    }
  }

  /** Files in XPP's working directory (what it reads and writes). */
  listFiles(): Array<{ name: string; size: number; mtime: number }> {
    if (!this.mod) return [];
    const FS = this.mod.FS;
    return FS.readdir('/work')
      .filter((n: string) => n !== '.' && n !== '..')
      .map((n: string) => ({ n, st: FS.stat('/work/' + n) }))
      .filter((f: any) => FS.isFile(f.st.mode))
      .map((f: any) => ({ name: f.n, size: f.st.size, mtime: +new Date(f.st.mtime) }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
  }

  readFile(name: string): Uint8Array {
    return this.mod.FS.readFile(name.startsWith('/') ? name : '/work/' + name);
  }

  /** Put a file in XPP's working directory (uploads). */
  writeFile(name: string, data: Uint8Array): void {
    this.mod.FS.writeFile('/work/' + name.replace(/[/\\]/g, '_'), data);
  }

  /** The .ode file XPP was started with. */
  odeName = '';

  // ---- called from C while XPP waits ----------------------------------

  private present(): void {
    const m = this.mod;
    if (this.needSync) this.syncPanels();
    for (const p of this.panels.values()) {
      if (!p.mapped || !m._xw_toplevel_dirty(p.id)) continue;
      const ptr = m._xw_render(p.id, this.sizePtr, this.sizePtr + 4);
      const w = m.HEAP32[this.sizePtr >> 2];
      const h = m.HEAP32[(this.sizePtr >> 2) + 1];
      if (!ptr || !w || !h) continue;
      if (p.canvas.width !== w || p.canvas.height !== h) {
        p.canvas.width = w;
        p.canvas.height = h;
        p.canvas.style.width = w + 'px';
        p.canvas.style.height = h + 'px';
        if (this.phone && p.id === this.activeId) requestAnimationFrame(() => this.fit(p.id));
      }
      const data = new ImageData(new Uint8ClampedArray(m.HEAPU8.buffer, ptr, w * h * 4).slice(), w, h);
      p.ctx.putImageData(data, 0, 0);
    }
  }

  private drainInput(): void {
    const q = this.input;
    this.input = [];
    for (const f of q) f();
  }

  private changedWindows = false;

  private syncPanels(): void {
    const m = this.mod;
    this.needSync = false;
    const before = this.windows().map((w) => w.id + ':' + w.title).join('|');
    const n = m._xw_toplevels(this.listPtr, 256);
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const id = m.HEAP32[(this.listPtr >> 2) + i] >>> 0;
      seen.add(id);
      if (!m._xw_toplevel_info(id, this.infoPtr)) continue;
      const b = this.infoPtr >> 2;
      let [x, y] = [m.HEAP32[b], m.HEAP32[b + 1]];
      const [w, h, mapped] = [m.HEAP32[b + 2], m.HEAP32[b + 3], m.HEAP32[b + 4]];
      let p = this.panels.get(id);
      const isNew = !p;
      if (!p) p = this.makePanel(id);
      p.mapped = !!mapped;
      const title = m.UTF8ToString(m._xw_title(id)) || 'XPP';
      p.title.textContent = title;
      if (mapped && !p.placed) {
        // first time shown: keep the title bar on screen, cascade windows
        // that all asked for the same corner
        p.placed = true;
        if (this.panels.size > 1 && x === 0 && y === 0) {
          this.cascade = (this.cascade + 1) % 10;
          x = 40 + 30 * this.cascade;
          y = 40 + 30 * this.cascade;
        }
        y = Math.max(y, TITLE_H);
        x = Math.max(x, 0);
        const [cx, cy] = [x, y];
        this.queue(() => m._xw_input_configure(id, cx, cy, 0, 0));
        this.raise(p);
        if (this.popOutNew && this.panels.size > 1 && isNew !== undefined) this.popOut(p, true);
      }
      if (!mapped && p.popup) { // XPP closed it: close the browser window
        const w = p.popup;
        p.popup = null;
        w.close();
        p.el.insertBefore(p.canvas, p.grip);
      }
      p.x = x;
      p.y = y;
      p.el.style.display = mapped && !p.popup ? '' : 'none';
      p.el.style.left = x + 'px';
      p.el.style.top = y - TITLE_H + 'px';
      p.canvas.style.width = w + 'px';
      p.canvas.style.height = h + 'px';
      if (p.popup && p.popup.document.title !== title) p.popup.document.title = title;
    }
    for (const [id, p] of this.panels)
      if (!seen.has(id)) {
        const w = p.popup;
        p.popup = null;
        w?.close();
        this.changedWindows = true;
        p.el.remove();
        this.panels.delete(id);
      }
    // the active window went away: activate the topmost remaining one
    const act = this.panels.get(this.activeId);
    if (!act || !act.mapped) {
      const top = [...this.panels.values()]
        .filter((q) => q.mapped)
        .sort((a, b) => +(b.el.style.zIndex || 0) - +(a.el.style.zIndex || 0))[0];
      if (top) this.raise(top);
    }
    if (this.phone) this.applyPhone();
    const after = this.windows().map((w) => w.id + ':' + w.title).join('|');
    if (after !== before || this.changedWindows) {
      this.changedWindows = false;
      this.onWindowsChanged();
    }
  }

  // ---- window manager ---------------------------------------------------

  private makePanel(id: number): Panel {
    const el = document.createElement('div');
    el.className = 'xwin';
    const bar = document.createElement('div');
    bar.className = 'xwin-bar';
    const title = document.createElement('span');
    title.className = 'xwin-title';
    const save = document.createElement('button');
    save.className = 'xwin-btn';
    save.title = 'Save this window as a PNG image';
    save.textContent = '⤓';
    const pop = document.createElement('button');
    pop.className = 'xwin-btn';
    pop.title = 'Open in a separate browser window';
    pop.textContent = '⧉';
    const close = document.createElement('button');
    close.className = 'xwin-btn';
    close.title = 'Close';
    close.textContent = '×';
    bar.append(title, save, pop, close);
    const canvas = document.createElement('canvas');
    canvas.className = 'xwin-canvas';
    canvas.width = canvas.height = 1;
    const grip = document.createElement('div');
    grip.className = 'xwin-grip';
    el.append(bar, canvas, grip);
    this.world.append(el);
    const p: Panel = {
      id, el, title, canvas, grip, ctx: canvas.getContext('2d')!,
      placed: false, mapped: false, x: 0, y: 0, popup: null,
    };
    this.panels.set(id, p);

    el.addEventListener('pointerdown', () => this.raise(p), true);
    pop.addEventListener('click', () => this.popOut(p, false));
    save.addEventListener('click', () => this.savePng(p));
    close.addEventListener('click', () => this.closeWindow(p));
    if (this.mainId === 0) this.mainId = id;
    this.dragMove(p, bar);
    this.dragResize(p, grip);
    this.pointerInput(p);
    return p;
  }

  /** The window manager's close button. XPP windows close through their own
      Close button (the C side presses it); the main window asks XPP to quit
      through its File / Quit menu, which confirms. */
  private closeWindow(p: Panel): void {
    if (p.id === this.mainId) {
      for (const k of ['Escape', 'f', 'q']) this.sendKey(k);
      return;
    }
    this.queue(() => this.mod._xw_input_close(p.id));
  }

  private sendKey(key: string): void {
    const [ks, text] = SPECIAL_KEYS[key] ?? [key.codePointAt(0)!, key];
    const m = this.mod;
    for (const press of [1, 0])
      this.queue(() => {
        const buf = m._malloc(8);
        m.stringToUTF8(text, buf, 8);
        m._xw_input_key(ks, buf, press, 0);
        m._free(buf);
      });
  }

  private savePng(p: Panel): void {
    const name = (p.title.textContent || 'xpp').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
    // download() also routes it to Downloads/XPPAUT in the Android app
    p.canvas.toBlob((b) => { if (b) download((name || 'xpp') + '.png', b); }, 'image/png');
  }

  private raise(p: Panel): void {
    p.el.style.zIndex = String(++this.zTop);
    this.queue(() => this.mod._xw_input_raise(p.id));
    if (this.activeId !== p.id && !(this.phone && this.isNote(p))) {
      this.activeId = p.id;
      if (this.phone) {
        this.applyPhone();
        this.fit(p.id);
      }
      this.onWindowsChanged();
    }
  }

  /** Move a panel's canvas into its own browser window. Browsers only allow
      this from a click (or shortly after one); returns false if blocked. */
  private popOut(p: Panel, automatic: boolean): boolean {
    if (p.popup) {
      p.popup.focus();
      return true;
    }
    const w = p.canvas.width;
    const h = p.canvas.height;
    const left = (window.screenX || 0) + p.x;
    const top = (window.screenY || 0) + p.y + 60;
    const win = window.open('', 'xpp-' + p.id, `popup,width=${w},height=${h},left=${left},top=${top}`);
    if (!win) {
      if (!automatic) this.cb.onNotice?.('Pop-up blocked: allow pop-ups for this site to use separate windows');
      return false;
    }
    const doc = win.document;
    doc.title = p.title.textContent || 'XPP';
    doc.body.style.cssText = 'margin:0;background:#808080;overflow:hidden';
    doc.body.append(p.canvas); // the canvas keeps its context and listeners
    p.popup = win;
    p.el.style.display = 'none';
    this.installKeyboard(win);
    win.addEventListener('pointerdown', () => this.queue(() => this.mod._xw_input_raise(p.id)), true);
    const opened = performance.now();
    win.addEventListener('resize', () => {
      // browsers settle a new window's size themselves; only follow the user
      if (performance.now() - opened < 1000) return;
      const nw = win.innerWidth;
      const nh = win.innerHeight;
      if (nw > 0 && nh > 0 && (nw !== p.canvas.width || nh !== p.canvas.height))
        this.queue(() => this.mod._xw_input_configure(p.id, p.x, p.y, nw, nh));
    });
    win.addEventListener('pagehide', () => {
      if (p.popup !== win) return; // closed by us (XPP closed the window)
      // the user closed the browser window: close the XPP window too; if it
      // has no way to close (the main window), put it back in the page
      if (p.id !== this.mainId) this.queue(() => this.mod._xw_input_close(p.id));
      this.dock(p);
      if (p.id !== this.mainId) p.el.style.display = 'none';
      setTimeout(() => {
        if (this.panels.has(p.id) && p.mapped && !p.popup) p.el.style.display = '';
      }, 800);
    });
    return true;
  }

  /** The browser window was closed: put the canvas back in its panel. */
  private dock(p: Panel): void {
    if (!p.popup) return;
    p.popup = null;
    p.el.insertBefore(p.canvas, p.grip);
    p.el.style.display = p.mapped && this.panels.has(p.id) ? '' : 'none';
    this.raise(p);
  }

  private dragMove(p: Panel, bar: HTMLElement): void {
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      const s = this.view.s; // drag in world coordinates (the view may be zoomed)
      const l0 = p.el.offsetLeft;
      const t0 = p.el.offsetTop;
      const cx = e.clientX;
      const cy = e.clientY;
      bar.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        p.el.style.left = Math.round(l0 + (ev.clientX - cx) / s) + 'px';
        p.el.style.top = Math.max(0, Math.round(t0 + (ev.clientY - cy) / s)) + 'px';
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        const x = p.el.offsetLeft;
        const y = p.el.offsetTop + TITLE_H;
        p.x = x;
        p.y = y;
        this.queue(() => this.mod._xw_input_configure(p.id, x, y, 0, 0));
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
  }

  private dragResize(p: Panel, grip: HTMLElement): void {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const w0 = p.canvas.width;
      const h0 = p.canvas.height;
      const sx = e.clientX;
      const sy = e.clientY;
      grip.setPointerCapture(e.pointerId);
      let w = w0;
      let h = h0;
      const sc = this.view.s;
      const move = (ev: PointerEvent) => {
        w = Math.max(100, Math.round(w0 + (ev.clientX - sx) / sc));
        h = Math.max(60, Math.round(h0 + (ev.clientY - sy) / sc));
        p.canvas.style.width = w + 'px';
        p.canvas.style.height = h + 'px';
      };
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        this.queue(() => this.mod._xw_input_configure(p.id, p.x, p.y, w, h));
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
  }

  // ---- input --------------------------------------------------------------

  private queue(f: () => void): void {
    if (this.running) this.input.push(f);
  }

  private modState(e: MouseEvent | KeyboardEvent): number {
    let s = this.buttons;
    if (e.shiftKey) s |= ShiftMask;
    if (e.ctrlKey) s |= ControlMask;
    if (e.altKey) s |= Mod1Mask;
    if (e.getModifierState?.('CapsLock')) s |= LockMask;
    return s;
  }

  /** root coordinates: the window's position plus the offset in its canvas
      (works docked or popped out) */
  private rootXY(p: Panel, e: { clientX: number; clientY: number }): [number, number] {
    const c = p.canvas;
    const r = c.getBoundingClientRect(); // on-screen box: includes zoom
    const sx = r.width ? c.width / r.width : 1;
    const sy = r.height ? c.height / r.height : 1;
    return [p.x + Math.floor((e.clientX - r.left) * sx), p.y + Math.floor((e.clientY - r.top) * sy)];
  }

  private pointerInput(p: Panel): void {
    const c = p.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // pointer capture keeps drags (rubber bands, sliders) going outside the
    // canvas; button changes are diffed from e.buttons so chords work too
    const handle = (e: PointerEvent) => {
      const [x, y] = this.rootXY(p, e);
      const before = this.buttons;
      let after = 0;
      for (const [bit, xb] of BUTTON_BITS) if (e.buttons & bit) after |= Button1Mask << (xb - 1);
      for (const [, xb] of BUTTON_BITS) {
        const m = Button1Mask << (xb - 1);
        if ((before ^ after) & m) {
          const press = after & m ? 1 : 0;
          const s = this.modState(e);
          this.buttons = press ? this.buttons | m : this.buttons & ~m;
          this.queue(() => this.mod._xw_input_button(x, y, xb, press, s));
        }
      }
      if (e.type === 'pointermove') {
        const s = this.modState(e);
        this.queue(() => this.mod._xw_input_motion(x, y, s));
      }
    };
    // touch: hold the press back briefly to tell a tap, a long press (right
    // button) and a drag apart; a second finger turns it into pinch/pan
    let t: { id: number; x0: number; y0: number; cx: number; cy: number; timer: number; drag: boolean; done: boolean; seq: number } | null = null;
    const touchEnd = (e: PointerEvent, cancel: boolean) => {
      if (!t || e.pointerId !== t.id) return;
      clearTimeout(t.timer);
      const [x, y] = this.rootXY(p, e);
      if (t.drag) {
        this.buttons &= ~Button1Mask;
        this.queue(() => this.mod._xw_input_button(x, y, 1, 0, Button1Mask));
      } else if (!t.done && !cancel && t.seq === this.multiTouchSeq) {
        const [x0, y0] = [t.x0, t.y0];
        this.queue(() => {
          this.mod._xw_input_button(x0, y0, 1, 1, 0);
          this.mod._xw_input_button(x0, y0, 1, 0, Button1Mask);
        });
      }
      t = null;
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      if (e.pointerType !== 'touch') return handle(e);
      if (this.touches.size > 1 || t) return; // pinch / second finger
      const [x0, y0] = this.rootXY(p, e);
      const id = e.pointerId;
      t = {
        id, x0, y0, cx: e.clientX, cy: e.clientY, drag: false, done: false, seq: this.multiTouchSeq,
        timer: window.setTimeout(() => {
          if (!t || t.id !== id || t.drag || this.touches.size > 1 || t.seq !== this.multiTouchSeq) return;
          t.done = true; // long press = right button
          this.queue(() => {
            this.mod._xw_input_button(x0, y0, 3, 1, 0);
            this.mod._xw_input_button(x0, y0, 3, 0, Button1Mask << 2);
          });
          navigator.vibrate?.(15);
        }, 550),
      };
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return handle(e);
      if (!t || e.pointerId !== t.id || t.done) return;
      if (this.touches.size > 1) { // became a pinch: abandon the XPP gesture
        clearTimeout(t.timer);
        if (t.drag) touchEnd(e, true);
        else t.done = true;
        return;
      }
      const [x, y] = this.rootXY(p, e);
      if (!t.drag && Math.hypot(e.clientX - t.cx, e.clientY - t.cy) > 10) {
        t.drag = true; // a drag: press where the finger went down
        clearTimeout(t.timer);
        const [x0, y0] = [t.x0, t.y0];
        this.buttons |= Button1Mask;
        this.queue(() => this.mod._xw_input_button(x0, y0, 1, 1, 0));
      }
      if (t.drag) this.queue(() => this.mod._xw_input_motion(x, y, Button1Mask));
    });
    c.addEventListener('pointerup', (e) => (e.pointerType === 'touch' ? touchEnd(e, false) : handle(e)));
    c.addEventListener('pointercancel', (e) => (e.pointerType === 'touch' ? touchEnd(e, true) : handle(e)));
    c.addEventListener('pointerleave', () => {
      if (!this.buttons) this.queue(() => this.mod._xw_input_motion(-100000, -100000, 0));
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const [x, y] = this.rootXY(p, e);
        const b = e.deltaY < 0 ? 4 : 5;
        const s = this.modState(e);
        this.queue(() => {
          this.mod._xw_input_button(x, y, b, 1, s);
          this.mod._xw_input_button(x, y, b, 0, s);
        });
      },
      { passive: false },
    );
  }

  private installGestures(): void {
    const d = this.desktop;
    const midDist = () => {
      const [a, b] = [...this.touches.values()];
      return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    };
    let pan: { id: number; x: number; y: number; tx0: number; ty0: number } | null = null;
    let twoTap: { t: number; moved: boolean } | null = null;
    d.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const r = d.getBoundingClientRect();
      this.touches.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (this.touches.size === 2) {
        pan = null;
        this.multiTouchSeq++;
        const { mx, my, dist } = midDist();
        this.gesture = { d0: dist, mx, my, s0: this.view.s, tx0: this.view.tx, ty0: this.view.ty };
        twoTap = { t: performance.now(), moved: false };
      } else if (this.touches.size === 1 && (e.target === d || e.target === this.world)) {
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY, tx0: this.view.tx, ty0: this.view.ty };
        d.setPointerCapture(e.pointerId);
      }
    }, true);
    d.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
      const r = d.getBoundingClientRect();
      this.touches.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (this.gesture && this.touches.size >= 2) {
        const g = this.gesture;
        const { mx, my, dist } = midDist();
        if (twoTap && (Math.abs(dist / g.d0 - 1) > 0.06 || Math.hypot(mx - g.mx, my - g.my) > 12)) twoTap.moved = true;
        const s = Math.min(4, Math.max(0.25, g.s0 * (dist / g.d0)));
        // keep the world point under the fingers' midpoint fixed
        const wx = (g.mx - g.tx0) / g.s0;
        const wy = (g.my - g.ty0) / g.s0;
        this.setView(s, mx - wx * s, my - wy * s);
      } else if (pan && e.pointerId === pan.id) {
        this.setView(this.view.s, pan.tx0 + e.clientX - pan.x, pan.ty0 + e.clientY - pan.y);
      }
    }, true);
    const up = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      this.touches.delete(e.pointerId);
      if (this.touches.size < 2) this.gesture = null;
      if (this.touches.size === 0 && twoTap) {
        // a quick two-finger tap without pinching or panning
        if (!twoTap.moved && performance.now() - twoTap.t < 350) this.onTwoFingerTap();
        twoTap = null;
      }
      if (pan && pan.id === e.pointerId) pan = null;
    };
    d.addEventListener('pointerup', up, true);
    d.addEventListener('pointercancel', up, true);
  }

  private installKeyboard(target: Window): void {
    if (!this.keyHandler)
      this.keyHandler = (e: KeyboardEvent) => {
        if (!this.running) return;
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        // keys belong to the page while a dialog is open (Esc closes it)
        if (t?.closest?.('dialog') || document.querySelector('dialog[open]')) return;
        if (e.metaKey || (e.ctrlKey && e.shiftKey)) return; // leave browser shortcuts alone
        let ks: number;
        let text: string;
        if (SPECIAL_KEYS[e.key]) [ks, text] = SPECIAL_KEYS[e.key];
        else if ([...e.key].length === 1) {
          const cp = e.key.codePointAt(0)!;
          ks = cp < 0x100 ? cp : 0x01000000 + cp;
          text = e.key;
        } else return; // modifiers, dead keys, ...
        e.preventDefault();
        const s = this.modState(e);
        const press = e.type === 'keydown' ? 1 : 0;
        const m = this.mod;
        this.queue(() => {
          const len = text.length * 4 + 1;
          const buf = m._malloc(len);
          m.stringToUTF8(text, buf, len);
          m._xw_input_key(ks, buf, press, s);
          m._free(buf);
        });
      };
    target.addEventListener('keydown', this.keyHandler);
    target.addEventListener('keyup', this.keyHandler);
  }

  private setCursor(w: number, shape: number): void {
    const p = this.panels.get(w >>> 0);
    if (p) p.canvas.style.cursor = CURSORS[shape - 1] ?? 'default';
  }

  private bell(): void {
    this.desktop.classList.remove('bell');
    void this.desktop.offsetWidth;
    this.desktop.classList.add('bell');
  }

  /** XPP's windows as currently shown (docked or popped out), stacking
      order bottom first, with their positions. */
  windowImages(): WindowImage[] {
    if (!this.running) return this.lastImages;
    return [...this.panels.values()]
      .filter((p) => p.mapped && p.canvas.width > 1)
      .sort((a, b) => +(a.el.style.zIndex || 0) - +(b.el.style.zIndex || 0))
      .map((p) => ({ title: p.title.textContent || 'XPP', x: p.x, y: p.y, canvas: p.canvas }));
  }

  /** pictures of the windows at the moment XPP quit */
  private lastImages: WindowImage[] = [];

  private exited(status: number): void {
    // keep copies of what was on screen, for "Save session" after quitting
    // (not XPP's own "Are you sure?" box, titled "!!" or "!!!!")
    this.lastImages = this.windowImages().filter((w) => /[A-Za-z0-9]/.test(w.title)).map((w) => {
      const c = document.createElement('canvas');
      c.width = w.canvas.width;
      c.height = w.canvas.height;
      c.getContext('2d')!.drawImage(w.canvas, 0, 0);
      return { ...w, canvas: c };
    });
    this.running = false;
    for (const p of this.panels.values()) {
      p.popup?.close();
      p.el.remove();
    }
    this.panels.clear();
    this.cb.onExit?.(status);
  }
}
