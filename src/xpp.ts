// Runs XPPAUT (WebAssembly) in the page and acts as its window manager:
// every top-level X window becomes a draggable panel holding a <canvas>, and
// any panel can be popped out into its own browser window.
// See web/xlib/platform_web.c for the C side of these hooks.

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

export interface XppCallbacks {
  onOutput?: (line: string) => void;
  onExit?: (status: number) => void;
  onNotice?: (message: string) => void;
}

export class XppSession {
  /** Open XPP's new windows (other than the main one) as browser windows. */
  popOutNew = false;

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
  private running = false;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  private desktop: HTMLElement;
  private cb: XppCallbacks;

  constructor(desktop: HTMLElement, cb: XppCallbacks = {}) {
    this.desktop = desktop;
    this.cb = cb;
  }

  /** Start XPP on an .ode file. Resolves once XPP is running. */
  async start(fileName: string, contents: string): Promise<void> {
    const url = new URL('wasm/xppaut.mjs', document.baseURI).href;
    const { default: createXpp } = await import(/* @vite-ignore */ url);
    const out = (s: string) => this.cb.onOutput?.(s);
    this.mod = await createXpp({
      noInitialRun: true,
      locateFile: (p: string) => new URL('wasm/' + p, document.baseURI).href,
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
      xppScreenWidth: () => this.desktop.clientWidth,
      xppScreenHeight: () => this.desktop.clientHeight,
    });
    const m = this.mod;
    this.infoPtr = m._malloc(5 * 4);
    this.listPtr = m._malloc(256 * 4);
    this.sizePtr = m._malloc(2 * 4);
    m.FS.mkdir('/work');
    m.FS.chdir('/work');
    m.FS.writeFile('/work/' + fileName, contents);
    this.installKeyboard(window);
    window.addEventListener('pagehide', () => {
      for (const p of this.panels.values()) p.popup?.close();
    });
    this.running = true;
    try {
      m.callMain([fileName]);
    } catch (e) {
      if (!(e && (e as any).name === 'ExitStatus')) throw e;
    }
  }

  /** Files XPP has written in its working directory. */
  listFiles(): string[] {
    if (!this.mod) return [];
    return this.mod.FS.readdir('/work').filter((n: string) => n !== '.' && n !== '..');
  }

  readFile(name: string): Uint8Array {
    return this.mod.FS.readFile('/work/' + name);
  }

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

  private syncPanels(): void {
    const m = this.mod;
    this.needSync = false;
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
      if (!mapped && p.popup) p.popup.close(); // XPP closed it: close the browser window
      p.x = x;
      p.y = y;
      p.el.style.display = mapped && !p.popup ? '' : 'none';
      p.el.style.left = x + 'px';
      p.el.style.top = y - TITLE_H + 'px';
      p.canvas.style.width = w + 'px';
      p.canvas.style.height = h + 'px';
      const title = m.UTF8ToString(m._xw_title(id)) || 'XPP';
      p.title.textContent = title;
      if (p.popup && p.popup.document.title !== title) p.popup.document.title = title;
    }
    for (const [id, p] of this.panels)
      if (!seen.has(id)) {
        p.popup?.close();
        p.el.remove();
        this.panels.delete(id);
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
    const pop = document.createElement('button');
    pop.className = 'xwin-btn';
    pop.title = 'Open in a separate browser window';
    pop.textContent = '⧉';
    const close = document.createElement('button');
    close.className = 'xwin-btn';
    close.title = 'Close';
    close.textContent = '×';
    bar.append(title, pop, close);
    const canvas = document.createElement('canvas');
    canvas.className = 'xwin-canvas';
    canvas.width = canvas.height = 1;
    const grip = document.createElement('div');
    grip.className = 'xwin-grip';
    el.append(bar, canvas, grip);
    this.desktop.append(el);
    const p: Panel = {
      id, el, title, canvas, grip, ctx: canvas.getContext('2d')!,
      placed: false, mapped: false, x: 0, y: 0, popup: null,
    };
    this.panels.set(id, p);

    el.addEventListener('pointerdown', () => this.raise(p), true);
    pop.addEventListener('click', () => this.popOut(p, false));
    close.addEventListener('click', () => this.queue(() => this.mod._xw_input_close(id)));
    this.dragMove(p, bar);
    this.dragResize(p, grip);
    this.pointerInput(p);
    return p;
  }

  private raise(p: Panel): void {
    p.el.style.zIndex = String(++this.zTop);
    this.queue(() => this.mod._xw_input_raise(p.id));
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
      if (!automatic) this.cb.onNotice?.('The browser blocked the new window. Allow pop-ups for this site to use separate windows.');
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
    win.addEventListener('pagehide', () => this.dock(p));
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
      const sx = e.clientX - p.el.offsetLeft;
      const sy = e.clientY - p.el.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        p.el.style.left = ev.clientX - sx + 'px';
        p.el.style.top = Math.max(0, ev.clientY - sy) + 'px';
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
      const move = (ev: PointerEvent) => {
        w = Math.max(100, w0 + ev.clientX - sx);
        h = Math.max(60, h0 + ev.clientY - sy);
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
  private rootXY(p: Panel, e: MouseEvent): [number, number] {
    const c = p.canvas;
    const sx = c.clientWidth ? c.width / c.clientWidth : 1;
    const sy = c.clientHeight ? c.height / c.clientHeight : 1;
    return [p.x + Math.floor(e.offsetX * sx), p.y + Math.floor(e.offsetY * sy)];
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
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      handle(e);
    });
    c.addEventListener('pointermove', handle);
    c.addEventListener('pointerup', handle);
    c.addEventListener('pointercancel', handle);
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

  private installKeyboard(target: Window): void {
    if (!this.keyHandler)
      this.keyHandler = (e: KeyboardEvent) => {
        if (!this.running) return;
        const t = e.target as HTMLElement;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
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

  private exited(status: number): void {
    this.running = false;
    for (const p of this.panels.values()) {
      p.popup?.close();
      p.el.remove();
    }
    this.panels.clear();
    this.cb.onExit?.(status);
  }
}
