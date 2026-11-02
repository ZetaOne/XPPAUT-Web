# XPPAUT-Web

Web port of XPPAUT: the original C source compiled to WebAssembly, with its
Xlib UI reimplemented on an HTML canvas.

**At the start of every session, read `STATUS.md`.** It has the goal, the chosen
approach and why, what is done, the next steps, and open decisions. Keep it
up to date when a step is finished or a decision is made.

Conventions:

- `xppaut/` is upstream XPPAUT 8.0. Keep edits minimal, mark each with an
  `XPPAUT-Web:` comment, and list it in the Patches table in
  `xppaut/UPSTREAM.md`.
- Check any change to the C build with
  `scripts/compare-batch.sh <runner>` against the desktop build
  (expected: 144 SAME, 9 NOOUT).
- Our own code goes in `web/` (C/Xlib layer) and `src/` (TypeScript front end).
