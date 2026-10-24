import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'

// Wie oft im laufenden Betrieb beim Dashboard nach einer neuen Version gefragt wird.
const CHECK_INTERVAL_MS = 10 * 60 * 1000

type UpdateState = 'checking' | 'latest' | 'downloading' | 'installing' | 'error'

const statusEl = document.getElementById('update-status')!
const progressEl = document.getElementById('update-progress') as HTMLElement & { value?: number }

function show(state: UpdateState, text: string, percent?: number) {
  statusEl.textContent = text
  statusEl.dataset.state = state
  progressEl.hidden = percent === undefined
  if (percent !== undefined) progressEl.value = percent
}

let running = false

async function runCheck() {
  if (running) return
  running = true
  try {
    show('checking', 'Suche nach Updates …')
    const update = await check()
    if (!update) {
      show('latest', 'Auf dem neuesten Stand')
      return
    }

    let total = 0
    let loaded = 0
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') total = event.data.contentLength ?? 0
      if (event.event === 'Progress') loaded += event.data.chunkLength
      if (event.event === 'Finished') {
        show('installing', `Update ${update.version} wird installiert …`)
        return
      }
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0
      show('downloading', `Update ${update.version} wird geladen …`, percent)
    })
    // Unter Windows beendet der Installer die App meist selbst; sonst hier neu starten.
    await relaunch()
  } catch (error) {
    show('error', `Update-Prüfung fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    running = false
  }
}

export async function startAutoUpdates() {
  const version = await getVersion()
  document.getElementById('version')!.textContent = `Version ${version}`
  // Im Entwicklungsmodus (tauri dev) gibt es keinen signierten Installer zum Aktualisieren.
  if (import.meta.env.DEV) {
    show('latest', 'Entwicklungsmodus – keine Updates')
    return
  }
  void runCheck()
  setInterval(runCheck, CHECK_INTERVAL_MS)
}
