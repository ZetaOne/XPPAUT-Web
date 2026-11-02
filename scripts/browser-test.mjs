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
