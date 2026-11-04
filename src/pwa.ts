import { inApp } from './android'

// Installable app (PWA): register the service worker (pwa/sw.js), offer an
// Install button, and tell the page when a new version has been deployed.

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/**
 * @param install  button shown while the browser offers installation
 * @param onUpdate called when a new version is ready; call `apply` to switch
 *                 to it (the page reloads)
 */
export function setupPwa(install: HTMLButtonElement, onUpdate: (apply: () => void) => void) {
  if (inApp) return // the Android app is installed and offline already
  // ---- Install button
  let offer: InstallPrompt | null = null
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // our button instead of the browser's banner
    offer = e as InstallPrompt
    install.hidden = false
  })
  install.addEventListener('click', async () => {
    if (!offer) return
    const o = offer
    offer = null
    install.hidden = true
    await o.prompt()
    await o.userChoice
  })
  window.addEventListener('appinstalled', () => {
    offer = null
    install.hidden = true
  })

  // installed apps: ask the browser not to clear the offline copy under storage pressure
  if (standalone()) void navigator.storage?.persist?.()

  // ---- service worker (built sites only; `npm run dev` has none)
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  let switching = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (switching) location.reload()
  })
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const ready = (w: ServiceWorker) =>
        onUpdate(() => {
          switching = true
          w.postMessage('skip-waiting')
        })
      // a new version waits only if an older one runs this page
      if (reg.waiting && navigator.serviceWorker.controller) ready(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w)
        })
      })
      // look for a new version when the app comes back, and hourly
      const check = () => void reg.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, 3600_000)
    })
    .catch(() => {
      /* no offline support (e.g. private window); the site still works */
    })
}
