import { setTheme } from '@fluentui/web-components'
import { webDarkTheme, webLightTheme } from '@fluentui/tokens'
// Nur die Komponenten registrieren, die wirklich genutzt werden – hält das Bundle klein.
import '@fluentui/web-components/button.js'
import '@fluentui/web-components/dropdown.js'
import '@fluentui/web-components/field.js'
import '@fluentui/web-components/listbox.js'
import '@fluentui/web-components/message-bar.js'
import '@fluentui/web-components/option.js'
import '@fluentui/web-components/progress-bar.js'
import '@fluentui/web-components/spinner.js'
import '@fluentui/web-components/text.js'
import '@fluentui/web-components/text-input.js'
import '@fluentui/web-components/textarea.js'
import { startApp } from './app'
import { startAutoUpdates } from './updater'

// Hell/Dunkel folgt wie bei Windows-Apps der Systemeinstellung.
const darkMode = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => setTheme(darkMode.matches ? webDarkTheme : webLightTheme)
applyTheme()
darkMode.addEventListener('change', applyTheme)

// Kein Browser-Kontextmenü („Neu laden", „Untersuchen") – wie in nativen Apps.
document.addEventListener('contextmenu', (event) => {
  if (!(event.target instanceof HTMLElement && event.target.closest('fluent-text-input, fluent-textarea'))) event.preventDefault()
})

startApp().catch((error: unknown) => {
  // Nie ein leeres Fenster: Startfehler sichtbar machen statt still abzubrechen.
  console.error(error)
  const bar = document.getElementById('login-error')!
  bar.textContent = `Die App konnte nicht starten: ${error instanceof Error ? error.message : String(error)}`
  bar.hidden = false
  document.getElementById('view-login')!.hidden = false
})
startAutoUpdates()
