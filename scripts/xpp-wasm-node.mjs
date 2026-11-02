#!/usr/bin/env node
// Run the WebAssembly build of XPPAUT under Node like a native binary:
//
//   scripts/xpp-wasm-node.mjs lecar.ode -silent
//
// The current directory is mounted into the Emscripten file system so XPP
// reads the .ode file and writes output.dat exactly as the desktop build does.
// Used by scripts/compare-batch.sh to check the wasm build.
import process from 'node:process';

const { default: createXpp } = await import(
  new URL('../build/wasm/xppaut.mjs', import.meta.url).href
);

const xpp = await createXpp({ noInitialRun: true });
xpp.FS.mkdir('/work');
xpp.FS.mount(xpp.NODEFS, { root: process.cwd() }, '/work');
xpp.FS.chdir('/work');

// With EXIT_RUNTIME the module calls process.exit() itself when XPP exits;
// this covers a normal return from main.
const rc = xpp.callMain(process.argv.slice(2));
process.exit(typeof rc === 'number' ? rc : 0);
