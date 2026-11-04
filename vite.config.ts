import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/** every file under `dir`, as paths relative to it ("assets/index-x.js") */
function walk(dir: string, sub = ''): string[] {
  return readdirSync(join(dir, sub), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(dir, join(sub, e.name)) : [join(sub, e.name).replaceAll('\\', '/')],
  )
}

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
        // videos (README tour) are played online only, not stored offline
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map') && !f.startsWith('videos/'))
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
})
