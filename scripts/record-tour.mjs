#!/usr/bin/env node
// Record the video tour of XPPAUT-Web (public/videos/tour.mp4) in headless Chrome:
// a scripted session with captions, a drawn mouse cursor and the keys pressed.
//
//   node scripts/record-tour.mjs [URL] [OUT.mp4]
//
// Default URL is the local preview (npm run preview, port 4173). Needs
// google-chrome and ffmpeg. Frames come from the DevTools screencast and are
// timed by their timestamps, so the video plays at real speed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const url = process.argv[2] || 'http://localhost:4173/';
const out = resolve(process.argv[3] || 'public/videos/tour.mp4');
const W = 1280, H = 760;
const chrome = process.env.CHROME || 'google-chrome';
const profile = mkdtempSync(join(tmpdir(), 'xppweb-tour-'));
const frames = join(profile, 'frames');
mkdirSync(frames);
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`,
  '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

// ---- overlay drawn into the page: caption, keys, cursor (not part of the site)
const OVERLAY = `(() => {
  const add = () => {
    if (document.getElementById('tour-cap')) return;
    const st = document.createElement('style');
    st.textContent = \`
      #tour-cap { position: fixed; z-index: 2147483000; left: 50%; bottom: 18px; transform: translateX(-50%);
        max-width: 86vw; padding: 9px 18px; border-radius: 10px; background: rgb(20 22 28 / .88); color: #fff;
        font: 500 19px/1.35 system-ui, sans-serif; text-align: center; pointer-events: none; transition: opacity .25s; }
      #tour-cap:empty { opacity: 0; }
      #tour-keys { position: fixed; z-index: 2147483000; right: 18px; bottom: 18px; display: flex; gap: 6px; pointer-events: none; }
      #tour-keys kbd { font: 700 20px/1 ui-monospace, monospace; color: #111; background: #fff; border: 1px solid #999;
        border-bottom-width: 3px; border-radius: 6px; padding: 6px 10px; box-shadow: 0 2px 8px rgb(0 0 0 / .35); }
      #tour-cursor { position: fixed; z-index: 2147483001; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none;
        transform: translate(-100px, -100px); }
      #tour-ring { position: fixed; z-index: 2147483000; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
        border: 3px solid #ffb000; pointer-events: none; opacity: 0; }
      #tour-ring.go { animation: tourring .45s ease-out; }
      @keyframes tourring { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.3); } }\`;
    document.head.append(st);
    const cap = document.createElement('div'); cap.id = 'tour-cap';
    const keys = document.createElement('div'); keys.id = 'tour-keys';
    const ring = document.createElement('div'); ring.id = 'tour-ring';
    const cur = document.createElement('div'); cur.id = 'tour-cursor';
    cur.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 1 L2 18 L6.5 13.8 L9.6 20.5 L12.6 19.2 L9.6 12.6 L15.5 12.6 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.append(cap, keys, ring, cur);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
})()`;

let cx = W / 2, cy = H / 2;
async function cursorAt(x, y) {
  cx = x; cy = y;
  await js(`(() => { const c = document.getElementById('tour-cursor'); if (c) c.style.transform = 'translate(${x}px, ${y}px)'; })()`);
}
async function moveTo(x, y, ms = 700) {
  const steps = Math.max(4, Math.round(ms / 35));
  const x0 = cx, y0 = cy;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const nx = x0 + (x - x0) * e, ny = y0 + (y - y0) * e;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: nx, y: ny });
    await cursorAt(nx, ny);
    await sleep(ms / steps);
  }
}
async function ring() {
  await js(`(() => { const r = document.getElementById('tour-ring'); if (!r) return; r.style.left='${cx}px'; r.style.top='${cy}px';
    r.classList.remove('go'); void r.offsetWidth; r.classList.add('go'); })()`);
}
async function click(x, y, ms = 700) {
  await moveTo(x, y, ms);
  await sleep(150);
  await ring();
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
}
async function drag(x1, y1, x2, y2, ms = 1200) {
  await moveTo(x1, y1);
  await sleep(150);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  const steps = Math.round(ms / 35);
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps, y = y1 + ((y2 - y1) * i) / steps;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
    await cursorAt(x, y);
    await sleep(35);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
}
/** centre of a page element */
async function at(sel) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
    const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  if (!r) throw new Error('no element ' + sel);
  return r;
}
const clickSel = async (sel, ms) => { const [x, y] = await at(sel); await click(x, y, ms); };
const hoverSel = async (sel, ms) => { const [x, y] = await at(sel); await moveTo(x, y, ms); };
/** a point inside the XPP window whose title starts with `title` (canvas pixels) */
async function win(title, x, y) {
  const r = await js(`(() => { for (const w of document.querySelectorAll('.xwin')) {
      if (!w.querySelector('.xwin-title').textContent.startsWith(${JSON.stringify(title)})) continue;
      const b = w.querySelector('.xwin-canvas').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; } return null; })()`);
  if (!r) throw new Error('no XPP window ' + title);
  return [r[0] + x, r[1] + y, r];
}
const winBtn = async (title, nth) => {
  const r = await js(`(() => { for (const w of document.querySelectorAll('.xwin')) {
      if (!w.querySelector('.xwin-title').textContent.startsWith(${JSON.stringify(title)})) continue;
      const b = w.querySelectorAll('.xwin-btn')[${nth}].getBoundingClientRect(); return [b.x + b.width/2, b.y + b.height/2]; } return null; })()`);
  if (!r) throw new Error('no XPP window ' + title);
  return r;
};

async function caption(text) {
  await js(`(() => { const c = document.getElementById('tour-cap'); if (c) c.innerHTML = ${JSON.stringify(text)}; })()`);
}
async function showKeys(list) {
  await js(`(() => { const k = document.getElementById('tour-keys'); if (k) k.innerHTML = ${JSON.stringify(list.map((x) => `<kbd>${x}</kbd>`).join(''))}; })()`);
}
const KEYCODES = { Enter: 13, Escape: 27, Tab: 9 };
async function key(k, label = k.length === 1 ? k.toUpperCase() : k) {
  const text = k.length === 1 ? k : k === 'Enter' ? '\r' : undefined;
  const code = KEYCODES[k] ?? k.toUpperCase().charCodeAt(0);
  shown.push(label);
  await showKeys(shown);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code });
  await sleep(450);
}
let shown = [];
async function keys(...ks) {
  shown = [];
  for (const k of ks) await key(k);
}
const clearKeys = async () => { shown = []; await showKeys([]); };
async function waitFor(expr, ms = 20000) {
  for (let t = 0; t < ms; t += 100) {
    if (await js(expr)) return;
    await sleep(100);
  }
  throw new Error('timed out: ' + expr);
}
async function setSelect(sel, value) {
  await js(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)};
    s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

// ---- recording
const shots = [];
let recording = false;
async function startCast() {
  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  recording = true;
}

let code = 0;
try {
  for (let i = 0; i < 100 && !ws; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { await sleep(100); }
  }
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    } else if (msg.method === 'Page.screencastFrame') {
      if (recording) shots.push({ t: msg.params.metadata.timestamp, data: msg.params.data });
      send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      send('Page.handleJavaScriptDialog', { accept: true });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log('page exception:', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(profile, 'downloads') });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: OVERLAY });
  await send('Page.navigate', { url });
  await waitFor(`!!document.getElementById('run') && document.getElementById('example').options.length > 10`);
  await waitFor(`document.getElementById('loadtext')?.textContent.includes('ready')`);
  await js(OVERLAY);
  await cursorAt(640, 420);
  await startCast();

  // ---------------------------------------------------------------- start screen
  await caption('XPPAUT-Web: the real XPPAUT, running in your browser');
  await sleep(2600);
  await caption('Pick one of the <b>212 example models</b>…');
  await hoverSel('#example');
  await sleep(900);
  await setSelect('#example', 'ode/lecar.ode');
  await sleep(1200);
  await caption('…or <b>Open .ode file…</b> to load your own model (with its .ani, .tab, .dat files)');
  await hoverSel('label.file');
  await sleep(2400);
  await caption('<b>Run</b> starts XPP with the Morris–Lecar neuron');
  await clickSel('#run');
  await waitFor('window.xpp && xpp.running && document.querySelector(".xwin")');
  await sleep(1500);

  // ---------------------------------------------------------------- keyboard
  await caption('XPP looks and works exactly as on the desktop. Keyboard commands too:');
  await sleep(2200);
  await caption('<b>I G</b> &nbsp;Initialconds → Go: integrate');
  await keys('i', 'g');
  await sleep(1600);
  await caption('<b>I L</b> &nbsp;Initialconds → Last: continue from the end point');
  await keys('i', 'l');
  await sleep(1300);
  await caption('<b>N N</b> &nbsp;Nullcline → New: draw the nullclines');
  await keys('n', 'n');
  await sleep(2200);
  await caption('<b>D D</b> &nbsp;Dir.field/flow → Direct field');
  await keys('d', 'd');
  await sleep(700);
  await key('Enter', 'Enter');
  await sleep(2200);
  await clearKeys();

  // ---------------------------------------------------------------- mouse
  await caption('Or use the mouse: click XPP\'s own menus and buttons');
  let [x, y] = await win('XPP Ver', 40, 222); // Erase
  await click(x, y);
  await sleep(900);
  [x, y] = await win('XPP Ver', 40, 58); // Initialconds
  await click(x, y);
  await sleep(700);
  await caption('Initialconds → <b>(M)ouse</b>: click in the plot to start a trajectory there');
  await keys('m');
  await clearKeys();
  [x, y] = await win('XPP Ver', 420, 200);
  await click(x, y);
  await sleep(1800);
  await caption('<b>ICs, Param, Eqns, Data</b> open XPP\'s other windows');
  [x, y] = await win('XPP Ver', 163, 8); // Param
  await click(x, y);
  await sleep(1800);
  await caption('Every window is a panel: <b>×</b> closes it…');
  await click(...(await winBtn('Parameters', 2)));
  await sleep(1200);

  // ---------------------------------------------------------------- window panel
  await caption('…drag the title bar to move it…');
  let bar = await js(`(() => { const b = document.querySelector('.xwin-bar').getBoundingClientRect(); return [b.x + 120, b.y + b.height/2]; })()`);
  await drag(bar[0], bar[1], bar[0] + 150, bar[1] + 30);
  await sleep(600);
  await caption('…and resize it from the corner; XPP redraws at the new size');
  const grip = await at('.xwin-grip');
  await drag(grip[0] - 2, grip[1] - 2, grip[0] + 70, grip[1] + 60);
  await sleep(1400);
  await caption('<b>⤓</b> saves the window as a PNG image');
  await click(...(await winBtn('XPP Ver', 0)));
  await sleep(1500);
  await caption('<b>⧉</b> pops it out into its own browser window (handy with two screens)');
  await moveTo(...(await winBtn('XPP Ver', 1)));
  await sleep(2400);

  // ---------------------------------------------------------------- exports
  await caption('<b>G V</b> &nbsp;Graphic stuff → sVg: export the plot as SVG');
  [x, y] = await win('XPP Ver', 420, 200);
  await moveTo(x, y, 500);
  await keys('g', 'v');
  await sleep(1200);
  await caption('XPP asks for a file name; Ok saves it. Exports download automatically');
  await key('Enter', 'Enter');
  await sleep(2400);
  await clearKeys();

  // ---------------------------------------------------------------- AUTO
  await caption('<b>F A</b> &nbsp;File → Auto opens AUTO for bifurcation diagrams');
  await keys('f', 'a');
  await waitFor(`[...document.querySelectorAll('.xwin-title')].some(t => t.textContent.startsWith("It's AUTO"))`);
  await sleep(1500);
  await clearKeys();
  await caption('AUTO: <b>Run → Steady state</b> follows the equilibria as <i>iapp</i> changes');
  [x, y] = await win("It's AUTO", 47, 87);
  await click(x, y);
  await sleep(600);
  await keys('s');
  await sleep(3500);
  await caption('Red: stable, black: unstable. Label 4 is a Hopf bifurcation');
  await clearKeys();
  await sleep(3000);

  // ---------------------------------------------------------------- toolbar
  await caption('<b>Files</b>: everything XPP saved. Download any file, or all as one .zip');
  await clickSel('#files > summary');
  await sleep(3200);
  await key('Escape', 'Esc');
  await clearKeys();
  await caption('<b>Edit .ode</b>: change the model, download it, or restart XPP with it');
  await clickSel('#edit');
  await sleep(3200);
  await clickSel('#editor button[value=cancel]');
  await sleep(500);
  await caption('<b>Settings</b>: where exports go, XPP\'s terminal output, phone or desktop layout');
  await clickSel('#settings > summary');
  await sleep(2600);
  await caption('Output → <b>Side panel</b> shows XPP\'s terminal messages');
  await hoverSel('#termmode');
  await setSelect('#termmode', 'side');
  await sleep(3000);
  await key('Escape', 'Esc');
  await clearKeys();
  await caption('<b>◐</b> Themes: ten colour schemes for the page');
  await clickSel('#themes > summary');
  await sleep(1400);
  await clickSel('#themelist button[data-theme="midnight"]');
  await sleep(1500);
  await clickSel('#themes > summary');
  await sleep(700);
  await clickSel('#themelist button[data-theme="dracula"]');
  await sleep(1500);
  await clickSel('#themes > summary');
  await sleep(700);
  await clickSel('#themelist button[data-theme="light"]');
  await sleep(1000);
  await setSelect('#termmode', 'hidden');
  await sleep(500);

  // ---------------------------------------------------------------- session
  await caption('<b>Model</b> switches to another example; <b>Restart</b> starts XPP again');
  await hoverSel('#restart');
  await sleep(1500);
  await hoverSel('#switch');
  await sleep(600);
  await setSelect('#switch', 'ode/pend.ode');
  await waitFor(`document.getElementById('leave').open`);
  await caption('Before leaving, it offers to <b>Save session</b>: one .zip with every file, screenshots of all windows and XPP\'s output');
  await sleep(3800);
  await clickSel('#leavesave');
  await waitFor('window.xpp && xpp.running && document.querySelector(".xwin-title")?.textContent.includes("pend")', 30000);
  await sleep(1200);
  await caption('The pendulum example: <b>I G</b> integrates. Everything runs in your browser; nothing is uploaded');
  await keys('i', 'g');
  await sleep(3000);
  await clearKeys();
  await caption('XPPAUT-Web &nbsp;·&nbsp; <b>zetaone.github.io/XPPAUT-Web</b> &nbsp;·&nbsp; works on phones and tablets, and installs as an app');
  await moveTo(W - 40, H - 120, 600);
  await sleep(4000);

  recording = false;
  await send('Page.stopScreencast');
  await sleep(300);
} catch (e) {
  console.error('record-tour:', e.message);
  code = 1;
}

// ---- encode: each frame lasts until the next one (real-time playback)
if (shots.length > 1) {
  const list = [];
  shots.forEach((s, i) => {
    const f = join(frames, `f${String(i).padStart(5, '0')}.jpg`);
    writeFileSync(f, Buffer.from(s.data, 'base64'));
    const d = i + 1 < shots.length ? shots[i + 1].t - s.t : 1;
    list.push(`file '${f}'`, `duration ${Math.max(0.001, d).toFixed(3)}`);
  });
  list.push(`file '${join(frames, `f${String(shots.length - 1).padStart(5, '0')}.jpg`)}'`);
  writeFileSync(join(frames, 'list.txt'), list.join('\n'));
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
    '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-movflags', '+faststart', out], { stdio: 'inherit' });
  if (r.status === 0) console.log(`wrote ${out} (${shots.length} frames, ${(shots.at(-1).t - shots[0].t).toFixed(1)} s)`);
  else code = 1;
}
proc.kill();
await sleep(200);
rmSync(profile, { recursive: true, force: true });
process.exit(code);
