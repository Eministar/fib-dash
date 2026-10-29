import { setTheme } from '@fluentui/web-components'
import { webDarkTheme, webLightTheme } from '@fluentui/tokens'
// Nur die Komponenten registrieren, die wirklich genutzt werden – hält das Bundle klein.
import '@fluentui/web-components/button.js'
import '@fluentui/web-components/checkbox.js'
import '@fluentui/web-components/dialog.js'
import '@fluentui/web-components/dialog-body.js'
import '@fluentui/web-components/dropdown.js'
import '@fluentui/web-components/field.js'
import '@fluentui/web-components/listbox.js'
import '@fluentui/web-components/message-bar.js'
import '@fluentui/web-components/option.js'
import '@fluentui/web-components/progress-bar.js'
import '@fluentui/web-components/spinner.js'
import '@fluentui/web-components/switch.js'
import '@fluentui/web-components/tab.js'
import '@fluentui/web-components/tablist.js'
import '@fluentui/web-components/text.js'
import '@fluentui/web-components/text-input.js'
import '@fluentui/web-components/textarea.js'
import './ui/controls.css'
import './investigations/investigations.css'
import './agents/agents.css'
import './pages/killclips.css'
import './pages/tweaks.css'
import './pages/news.css'
import { startApp } from './app'
import { backend } from './backend'
import { startAutoUpdates } from './updater'

// Hell/Dunkel folgt wie bei Windows-Apps der Systemeinstellung.
const darkMode = window.matchMedia('(prefers-color-scheme: dark)')
// Schrift wie in Windows-11-Apps; ältere Systeme fallen auf Segoe UI zurück.
const fontFamilyBase = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
const applyTheme = () => setTheme({ ...(darkMode.matches ? webDarkTheme : webLightTheme), fontFamilyBase })
applyTheme()
darkMode.addEventListener('change', applyTheme)

// Kein Browser-Kontextmenü („Neu laden", „Untersuchen") – wie in nativen Apps.
document.addEventListener('contextmenu', (event) => {
  if (!(event.target instanceof HTMLElement && event.target.closest('fluent-text-input, fluent-textarea'))) event.preventDefault()
})

// Links (Ankündigungen, Versionshinweise) im Browser öffnen statt im App-Fenster.
document.addEventListener('click', (event) => {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  if (!anchor) return
  event.preventDefault()
  if (/^https?:\/\//.test(anchor.href)) void backend.openExternal(anchor.href)
})

// Profilbild nicht ladbar (offline, gelöschter Avatar) → Initialen bleiben sichtbar.
document.addEventListener('error', (event) => {
  if (event.target instanceof HTMLImageElement && event.target.classList.contains('avatar-img')) event.target.remove()
}, true)

// Echte Programmfehler im Fenster anonym melden (Rust prüft Einstellung und Limit).
// Abgelehnte Befehle liefern nur Text (z. B. „Dashboard nicht erreichbar“) – das sind
// erwartete Fehler und werden nicht gemeldet.
function reportWindowError(error: unknown) {
  if (!(error instanceof Error)) return
  void backend.reportError(`${error.name}: ${error.message}`, error.stack ?? null).catch(() => {})
}
window.addEventListener('error', (event) => reportWindowError(event.error))
window.addEventListener('unhandledrejection', (event) => reportWindowError(event.reason))

startApp().catch((error: unknown) => {
  reportWindowError(error)
  // Nie ein leeres Fenster: Startfehler sichtbar machen statt still abzubrechen.
  console.error(error)
  const bar = document.getElementById('login-error')!
  bar.textContent = `Die App konnte nicht starten: ${error instanceof Error ? error.message : String(error)}`
  bar.hidden = false
  document.getElementById('view-login')!.hidden = false
})
startAutoUpdates()
import './pages/families.css'
import './ui/map.css'
