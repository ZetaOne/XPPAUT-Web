// XPPAUT-Web service worker: makes the site an installable app that works
// offline. The build (vite.config.ts) fills in VERSION and FILES; every change
// to the site gives a new VERSION, hence a new worker and an "update" prompt.
const VERSION = __VERSION__
const FILES = __FILES__
const CACHE = 'xppaut-web-' + VERSION
const PREFIX = 'xppaut-web-'

// only the WebAssembly build this browser runs (see xppBuild() in src/xpp.ts)
const jspi = typeof WebAssembly === 'object' && 'Suspending' in WebAssembly
const WANTED = FILES.filter((f) => (jspi ? !/^wasm\/xppaut\./.test(f) : !f.startsWith('wasm/jspi/')))

const scope = new URL(self.registration.scope)
const INDEX = new URL('index.html', scope).href

self.addEventListener('install', (event) => {
  // everything the app needs offline: page, XPP, examples, help (~3 MB).
  // no-cache: revalidate with the server, never take a stale HTTP-cached copy
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(WANTED.map((f) => new Request(f, { cache: 'no-cache' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

// the page asks for the new version when the user accepts the update
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  // the app itself, whatever its ?ode=... : the cached page of this version
  const rest = url.pathname.slice(scope.pathname.length)
  if (req.mode === 'navigate' && (rest === '' || rest === 'index.html')) {
    event.respondWith(caches.match(INDEX, { ignoreVary: true }).then((r) => r || fetch(req)))
    return
  }

  // anything else: from the cache, else from the network (and keep a copy)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      // ignoreVary: copies were stored without the Origin header that module
      // scripts and fetches send, and the server may answer "Vary: Origin"
      const hit = await cache.match(req, { ignoreVary: true })
      if (hit) return hit
      const res = await fetch(req)
      if (res.status === 200 && res.type === 'basic') cache.put(req, res.clone())
      return res
    })(),
  )
})
