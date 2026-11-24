import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
import { defineConfig, type Plugin } from 'vite'

/** every file under `dir`, as paths relative to it ("assets/index-x.js") */
function walk(dir: string, sub = ''): string[] {
  return readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(sub, e.name)) : [join(sub, e.name).replaceAll('\\', '/')],
  )
}

/** voice engines (assets/voice-*) and their files (voice/): not kept offline
 *  with the page; the page downloads and keeps them when chosen */
const isVoice = (f: string) =>
  f.startsWith('voice/') || f.startsWith('assets/voice-') || /ort-wasm/.test(f) ||
  // the editor's engines (Monaco, CodeMirror) and Ghostscript: when the editor is used
  /^assets\/editor[.-]/.test(f) || /gs-worker|gs-[^/]*\.wasm/.test(f)

/**
 * Writes dist/sw.js from pwa/sw.js after the build: the list of files to keep
 * offline and a version that is a hash of all of them, so each deploy that
 * changes anything installs a new worker (and the page offers to update).
 */
function serviceWorker(): Plugin {
  let root = '.'
  let outDir = 'dist'
  return {
    name: 'xpp-service-worker',
    apply: 'build',
    configResolved(c) {
      root = c.root
      outDir = resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      const files = walk(outDir)
        // videos (README tour) are played online only, not stored offline;
        // voice engines and models download only when chosen (Settings -> Voice)
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('videos/') && !isVoice(f))
        .sort()
      const template = readFileSync(resolve(root, 'pwa/sw.js'), 'utf8')
      const hash = createHash('sha256').update(template) // a changed worker is a new version too
      for (const f of files) hash.update(f + '\0').update(readFileSync(join(outDir, f)))
      const version = hash.digest('hex').slice(0, 12)
      const src = template
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(files))
      writeFileSync(join(outDir, 'sw.js'), src)
      console.log(`sw.js: version ${version}, ${files.length} files`)
    },
  }
}

// Relative asset paths, so the built site works from any folder
// (e.g. https://<user>.github.io/XPPAUT-Web/) as well as from the root.
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  resolve: {
    // Whisper (transformers.js) on ONNX Runtime's plain WebAssembly build (14 MB,
    // no WebGPU): the same everywhere, and the smaller download
    alias: [
      { find: /^onnxruntime-web\/webgpu$/, replacement: 'onnxruntime-web/wasm' },
      // Monaco's CSS files (its package exports map every path to .js)
      { find: /^monaco-esm\//, replacement: resolve(__dirname, 'node_modules/monaco-editor/esm/vs') + '/' },
    ],
  },
  build: {
    rollupOptions: {
      // the editor is a page of its own (editor.html, opened in a new tab)
      input: { main: resolve(__dirname, 'index.html'), editor: resolve(__dirname, 'editor.html') },
      output: {
        // the voice engines in their own files, loaded only when chosen
        manualChunks(id) {
          if (id.includes('node_modules/vosk-browser')) return 'voice-vosk'
          if (/node_modules\/(@huggingface|onnxruntime)/.test(id)) return 'voice-whisper'
          if (id.includes('node_modules/monaco-editor') || id.includes('src/editor/monaco')) return 'editor-monaco'
          if (/node_modules\/(@codemirror|@lezer|codemirror|crelt|style-mod|w3c-keyname)/.test(id) || id.includes('src/editor/cm.ts')) return 'editor-codemirror'
        },
      },
    },
  },
})
