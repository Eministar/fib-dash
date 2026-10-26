import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { backend } from './backend'
import { $, escapeHtml, type ButtonElement, type ProgressElement } from './dom'
import { formatBytes } from './format'
import { renderReleaseNotes } from './markdown'
import { bodycamQueueLength } from './pages/bodycam'
import { showReleaseNotes } from './pages/news'
import { toast } from './ui/toast'

// Updates passieren sichtbar: Beim Start ein eigener Bildschirm mit Fortschritt
// und Neuerungen, im laufenden Betrieb nur ein Hinweis – installiert wird dann
// erst, wenn man selbst neu startet (oder beim nächsten Start).

// Wie oft im laufenden Betrieb nach einer neuen Version gefragt wird.
const CHECK_INTERVAL_MS = 10 * 60 * 1000
// So lange wartet der Start höchstens auf den Update-Server.
const STARTUP_TIMEOUT_MS = 6000
// Sekunden zwischen „Fertig geladen“ und dem Schließen für den Installer.
const RESTART_COUNTDOWN = 3
// Version + Hinweise des gerade installierten Updates – für „Was ist neu“ nach dem Neustart.
const INSTALLED_KEY = 'fib-desktop.update-installed'

type DialogElement = HTMLElement & { show(): void; hide(): void }

let current = ''
let running = false
/** Fertig geladenes Update, das auf „Jetzt neu starten“ wartet. */
let ready: Update | null = null
let lastCheck: Date | null = null

const timeFormat = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' })

// ── Einstellungen → Info ─────────────────────────────────────────────

function status(text: string, percent?: number) {
  $('update-status').textContent = text
  const progress = $<ProgressElement>('update-progress')
  progress.hidden = percent === undefined
  if (percent !== undefined) progress.value = percent
}

function checkedText() {
  return lastCheck ? `Auf dem neuesten Stand · zuletzt geprüft um ${timeFormat.format(lastCheck)} Uhr` : 'Auf dem neuesten Stand'
}

// ── Update-Bildschirm beim Start ─────────────────────────────────────

function showScreen(update: Update) {
  document.body.classList.add('updating')
  $('update-screen').hidden = false
  $('update-screen-title').textContent = 'Update wird installiert'
  $('update-screen-version').innerHTML = `Version ${escapeHtml(current)} <span aria-hidden="true">→</span> <strong>${escapeHtml(update.version)}</strong>`
  $('update-screen-detail').textContent = 'Wird geladen …'
  const progress = $<ProgressElement>('update-screen-progress')
  progress.removeAttribute('value')
  $('update-screen-notes-body').innerHTML = renderReleaseNotes(update.body)
}

function hideScreen() {
  document.body.classList.remove('updating')
  $('update-screen').hidden = true
}

/** Fortschritt aus den Download-Ereignissen; `onProgress` bekommt Prozent und Text. */
function progressTracker(onProgress: (percent: number | undefined, text: string) => void) {
  let total = 0
  let loaded = 0
  return (event: DownloadEvent) => {
    if (event.event === 'Started') total = event.data.contentLength ?? 0
    if (event.event === 'Progress') loaded += event.data.chunkLength
    if (event.event === 'Finished') return onProgress(100, 'Fertig geladen')
    onProgress(
      total > 0 ? Math.round((loaded / total) * 100) : undefined,
      total > 0 ? `${formatBytes(loaded)} von ${formatBytes(total)}` : formatBytes(loaded),
    )
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Zeigt den Bildschirm mit Countdown und startet den Installer. Unter Windows
 * beendet `install()` die App; der Installer startet sie danach selbst neu.
 */
async function install(update: Update) {
  showScreen(update)
  $('update-screen-title').textContent = 'Update ist bereit'
  $<ProgressElement>('update-screen-progress').value = 100
  try {
    localStorage.setItem(INSTALLED_KEY, JSON.stringify({ version: update.version, notes: update.body ?? '' }))
  } catch {
    // Dann eben ohne „Was ist neu“.
  }
  for (let left = RESTART_COUNTDOWN; left > 0; left--) {
    $('update-screen-detail').textContent = `FIB Desktop startet in ${left} s neu – das Fenster schließt sich dafür kurz.`
    await wait(1000)
  }
  $('update-screen-detail').textContent = 'Wird installiert …'
  // Der Installer beendet die App – kein Absturz, also nichts melden.
  await backend.prepareRestart().catch(() => {})
  await update.install()
  await relaunch()
}

async function installOnStartup(update: Update) {
  showScreen(update)
  try {
    await update.download(
      progressTracker((percent, text) => {
        const progress = $<ProgressElement>('update-screen-progress')
        if (percent === undefined) progress.removeAttribute('value')
        else progress.value = percent
        $('update-screen-detail').textContent = text
      }),
    )
    await install(update)
  } catch (error) {
    hideScreen()
    status(`Update fehlgeschlagen: ${errorMessage(error)}`)
    toast(`Update auf ${update.version} fehlgeschlagen – die App läuft mit Version ${current} weiter.`, 'error')
  }
}

// ── Im laufenden Betrieb ─────────────────────────────────────────────

function showBanner(update: Update) {
  $('update-banner-text').textContent = `Version ${update.version} ist bereit. Ein Neustart dauert nur ein paar Sekunden.`
  $('update-banner').hidden = false
  status(`Version ${update.version} ist geladen und wird beim nächsten Start installiert.`)
}

/** Lädt ein gefundenes Update im Hintergrund und bietet dann den Neustart an. */
async function prepareInBackground(update: Update) {
  await update.download(progressTracker((percent, text) => status(`Update ${update.version} wird geladen … ${text}`, percent)))
  ready = update
  showBanner(update)
}

async function backgroundCheck(manual = false) {
  if (running) return
  if (ready) {
    if (manual) showBanner(ready)
    return
  }
  running = true
  const button = $<ButtonElement>('update-check')
  button.disabled = true
  try {
    status('Suche nach Updates …')
    const update = await check()
    lastCheck = new Date()
    if (!update) {
      status(checkedText())
      if (manual) toast('FIB Desktop ist auf dem neuesten Stand.')
      return
    }
    await prepareInBackground(update)
  } catch (error) {
    status(`Update-Prüfung fehlgeschlagen: ${errorMessage(error)}`)
    if (manual) toast(`Update-Prüfung fehlgeschlagen: ${errorMessage(error)}`, 'error')
  } finally {
    running = false
    button.disabled = false
  }
}

function restartNow() {
  if (!ready) return
  if (bodycamQueueLength()) {
    toast('Erst wenn die Bodycam-Uploads fertig sind – sonst gehen sie verloren.', 'warning')
    return
  }
  $('update-banner').hidden = true
  void install(ready).catch((error) => {
    hideScreen()
    toast(`Update fehlgeschlagen: ${errorMessage(error)}`, 'error')
  })
}

// ── Nach dem Update: „Was ist neu“ ───────────────────────────────────

function showWhatsNew() {
  let installed: { version: string; notes: string } | null = null
  try {
    installed = JSON.parse(localStorage.getItem(INSTALLED_KEY) ?? 'null')
    localStorage.removeItem(INSTALLED_KEY)
  } catch {
    return
  }
  // Nur wenn das Update wirklich angekommen ist (nicht abgebrochen).
  if (!installed || installed.version !== current) return
  $('whatsnew-version').textContent = installed.version
  $('whatsnew-notes').innerHTML = renderReleaseNotes(installed.notes)
  $<DialogElement>('whatsnew-dialog').show()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// ── Start ────────────────────────────────────────────────────────────

export async function startAutoUpdates() {
  current = await getVersion()
  $('version').textContent = `Version ${current}`

  $('update-check').addEventListener('click', () => void backgroundCheck(true))
  $('update-restart').addEventListener('click', restartNow)
  $('update-later').addEventListener('click', () => {
    $('update-banner').hidden = true
  })
  const whatsNew = $<DialogElement>('whatsnew-dialog')
  $('whatsnew-close').addEventListener('click', () => whatsNew.hide())
  $('whatsnew-all').addEventListener('click', () => {
    whatsNew.hide()
    showReleaseNotes()
  })
  showWhatsNew()

  // Im Entwicklungsmodus (tauri dev) gibt es keinen signierten Installer zum Aktualisieren.
  if (import.meta.env.DEV) {
    status('Entwicklungsmodus – keine Updates')
    $<ButtonElement>('update-check').disabled = true
    return
  }

  running = true
  status('Suche nach Updates …')
  const pending = check()
  try {
    // Nicht ewig auf einen langsamen Server warten – dann läuft die Prüfung im Hintergrund weiter.
    const update = await Promise.race([pending, wait(STARTUP_TIMEOUT_MS).then(() => 'timeout' as const)])
    if (update === 'timeout') {
      void pending
        .then((late) => {
          lastCheck = new Date()
          return late ? prepareInBackground(late) : status(checkedText())
        })
        .catch((error: unknown) => status(`Update-Prüfung fehlgeschlagen: ${errorMessage(error)}`))
    } else if (update) {
      lastCheck = new Date()
      await installOnStartup(update)
    } else {
      lastCheck = new Date()
      status(checkedText())
    }
  } catch (error) {
    status(`Update-Prüfung fehlgeschlagen: ${errorMessage(error)}`)
  } finally {
    running = false
  }
  setInterval(() => void backgroundCheck(), CHECK_INTERVAL_MS)
}
