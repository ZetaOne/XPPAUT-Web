#!/usr/bin/env node
// Drive the web app in headless Chrome over the DevTools protocol (no extra
// packages; uses a throwaway profile). Steps run in order:
//
//   node scripts/browser-test.mjs URL "wait 3000" "key i" "key g" "shot out.png"
//
//   wait MS            sleep
//   waitfor JS         poll until the expression is truthy (10 s timeout)
//   key KEY            press and release (KeyboardEvent.key, e.g. i, Enter)
//   type TEXT          type characters
//   click X Y          left click at page coordinates
//   drag X1 Y1 X2 Y2   press, move, release
//   shot FILE.png      screenshot of the viewport
//   eval JS            print the value of an expression
//   targets            list open browser windows (pages) and their titles
//   popshot TITLE F    screenshot of another browser window by title prefix
//   popclose TITLE     close another browser window by title prefix
//   popclick TITLE X Y click in another browser window
//   downloads DIR      save downloads into DIR
//   throttle KBPS MS   emulate a slow network (download kbit/s, latency ms)
//   netlog             print every network response with its size (after load)
//   device W H         emulate a touch device W x H (phone/tablet); navigate after
//   tap X Y / longpress X Y / tdrag X1 Y1 X2 Y2   touch gestures
//   pinch X Y F        two-finger pinch around X,Y by factor F (e.g. 1.5)
//   inserttext TEXT    type TEXT the way a phone keyboard does (text input)
//   twotap X Y         quick two-finger tap
//   tapsel SEL         tap the centre of the element matching SEL
//   wclick TITLE X Y   click at X,Y inside the XPP window (panel) whose title
//                      starts with TITLE (use _ for spaces in TITLE)
//   upload SEL FILE..  set the files of the <input type=file> matching SEL
//
// Console output from the page is printed with a "page:" prefix.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, ...steps] = process.argv.slice(2);
const chrome = process.env.CHROME || 'google-chrome';
const profile = mkdtempSync(join(tmpdir(), 'xppweb-chrome-'));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error('chrome did not start');
}

const KEYCODES = { Enter: 13, Escape: 27, Backspace: 8, Tab: 9, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
async function key(k) {
  const text = k.length === 1 ? k : k === 'Enter' ? '\r' : undefined;
  const code = KEYCODES[k] ?? k.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code });
}
async function mouse(type, x, y, buttons = 0) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: 1 });
}

let code = 0;
try {
  ws = new WebSocket(await connect());
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('page:', msg.params.args.map((a) => a.value ?? a.description).join(' '));
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      // browser-level prompts (e.g. "Leave site?"): report and accept
      console.log('browser dialog:', msg.params.type, JSON.stringify(msg.params.message));
      send('Page.handleJavaScriptDialog', { accept: true });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log('page exception:', msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(500);
  for (const step of steps) {
    const [cmd, ...a] = step.split(' ');
    const rest = step.slice(cmd.length + 1);
    if (cmd === 'wait') await sleep(+a[0]);
    else if (cmd === 'waitfor') {
      let ok = false;
      for (let i = 0; i < 100 && !ok; i++) {
        const r = await send('Runtime.evaluate', { expression: rest, returnByValue: true });
        ok = !!r.result.value;
        if (!ok) await sleep(100);
      }
      if (!ok) throw new Error('timed out waiting for: ' + rest);
    } else if (cmd === 'key') await key(rest);
    else if (cmd === 'type') for (const c of rest) await key(c);
    else if (cmd === 'click') {
      await mouse('mouseMoved', +a[0], +a[1]);
      await mouse('mousePressed', +a[0], +a[1], 1);
      await mouse('mouseReleased', +a[0], +a[1]);
    } else if (cmd === 'drag') {
      await mouse('mouseMoved', +a[0], +a[1]);
      await mouse('mousePressed', +a[0], +a[1], 1);
      for (let i = 1; i <= 10; i++) await mouse('mouseMoved', +a[0] + ((a[2] - a[0]) * i) / 10, +a[1] + ((a[3] - a[1]) * i) / 10, 1);
      await mouse('mouseReleased', +a[2], +a[3]);
    } else if (cmd === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(rest, Buffer.from(r.data, 'base64'));
    } else if (cmd === 'targets') {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      console.log(JSON.stringify(list.filter((t) => t.type === 'page').map((t) => t.title)));
    } else if (cmd === 'popshot') {
      const title = a[0];
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const t = list.find((x) => x.type === 'page' && x.title.startsWith(title));
      if (!t) throw new Error('no browser window titled ' + title);
      const pws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => pws.addEventListener('open', r));
      const shot = await new Promise((res) => {
        pws.addEventListener('message', (m) => {
          const msg = JSON.parse(m.data);
          if (msg.id === 1) res(msg.result);
        });
        pws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      });
      writeFileSync(a[1], Buffer.from(shot.data, 'base64'));
      pws.close();
    } else if (cmd === 'popclick') {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const t = list.find((x) => x.type === 'page' && x.title.startsWith(a[0]));
      if (!t) throw new Error('no browser window titled ' + a[0]);
      const pws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r) => pws.addEventListener('open', r));
      let id = 0;
      const call = (method, params) => new Promise((res) => {
        const my = ++id;
        const on = (m) => { const msg = JSON.parse(m.data); if (msg.id === my) { pws.removeEventListener('message', on); res(msg); } };
        pws.addEventListener('message', on);
        pws.send(JSON.stringify({ id: my, method, params }));
      });
      const [x, y] = [+a[1], +a[2]];
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      pws.close();
    } else if (cmd === 'device') {
      await send('Emulation.setDeviceMetricsOverride', { width: +a[0], height: +a[1], deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }, { name: 'any-hover', value: 'none' }, { name: 'any-pointer', value: 'coarse' }] }).catch(() => {});
    } else if (cmd === 'tap' || cmd === 'longpress') {
      const pt = [{ x: +a[0], y: +a[1], id: 1 }];
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      await sleep(cmd === 'tap' ? 60 : 800);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (cmd === 'tdrag') {
      const [x1, y1, x2, y2] = a.map(Number);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
      for (let i = 1; i <= 10; i++) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, id: 1 }] });
        await sleep(20);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (cmd === 'twotap') {
      const [x, y] = a.map(Number);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
      await sleep(80);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (cmd === 'inserttext') {
      await send('Input.insertText', { text: rest });
    } else if (cmd === 'tapsel') {
      const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const b = document.querySelector(${JSON.stringify(rest)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()` });
      const [x, y] = r.result.value;
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await sleep(60);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (cmd === 'pinch') {
      const [cx, cy, f] = a.map(Number);
      const d0 = 60;
      const pts = (d) => [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }];
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
      for (let i = 1; i <= 10; i++) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 * (1 + ((f - 1) * i) / 10)) });
        await sleep(20);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else if (cmd === 'wclick') {
      const t = a[0].replace(/_/g, ' ');
      const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const p = [...document.querySelectorAll('.xwin')].find((e) => e.style.display !== 'none' &&
          e.querySelector('.xwin-title').textContent.startsWith(${JSON.stringify(t)}));
        if (!p) return null;
        const c = p.querySelector('canvas').getBoundingClientRect();
        return [c.left, c.top];
      })()` });
      if (!r.result.value) throw new Error('no XPP window titled ' + t);
      const [x, y] = [r.result.value[0] + +a[1], r.result.value[1] + +a[2]];
      await mouse('mouseMoved', x, y);
      await mouse('mousePressed', x, y, 1);
      await mouse('mouseReleased', x, y);
    } else if (cmd === 'throttle') {
      await send('Network.enable');
      await send('Network.emulateNetworkConditions', { offline: false, latency: +a[1],
        downloadThroughput: (+a[0] * 1000) / 8, uploadThroughput: (+a[0] * 1000) / 8 });
    } else if (cmd === 'netlog') {
      const r = await send('Runtime.evaluate', { returnByValue: true, expression:
        `performance.getEntriesByType('resource').map(e => [e.name.replace(location.origin, ''), e.transferSize, e.decodedBodySize, Math.round(e.responseEnd)])` });
      for (const [n, t, d, end] of r.result.value) console.log(`  ${String(t).padStart(8)} B sent ${String(d).padStart(8)} B  done ${end} ms  ${n}`);
    } else if (cmd === 'downloads') {
      await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: a[0], eventsEnabled: true });
    } else if (cmd === 'upload') {
      const doc = await send('DOM.getDocument', { depth: -1, pierce: true });
      const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: a[0] });
      await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: a.slice(1) });
    } else if (cmd === 'popclose') {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const t = list.find((x) => x.type === 'page' && x.title.startsWith(rest));
      if (!t) throw new Error('no browser window titled ' + rest);
      await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`);
    } else if (cmd === 'eval') {
      const r = await send('Runtime.evaluate', { expression: rest, returnByValue: true });
      console.log(JSON.stringify(r.result.value ?? r.result.description));
    } else throw new Error('unknown step: ' + step);
  }
} catch (e) {
  console.error('browser-test:', e.message);
  code = 1;
} finally {
  proc.kill();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
  process.exit(code);
}
