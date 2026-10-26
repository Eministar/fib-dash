import { setTheme } from '@fluentui/web-components'
import { webDarkTheme, webLightTheme } from '@fluentui/tokens'
import '@fluentui/web-components/button.js'
import '@fluentui/web-components/message-bar.js'
import '@fluentui/web-components/textarea.js'
import { invoke } from '@tauri-apps/api/core'
import './ui/controls.css'
import { api } from './api'
import { UNAUTHORIZED } from './backend'

// Kleines Fenster der Schnellnotiz (eigene Taste, auch im Spiel). Speichert eine
// persönliche Notiz und gibt den Fokus danach an das vorherige Fenster zurück.

const darkMode = window.matchMedia('(prefers-color-scheme: dark)')
const fontFamilyBase = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif"
const applyTheme = () => setTheme({ ...(darkMode.matches ? webDarkTheme : webLightTheme), fontFamilyBase })
applyTheme()
darkMode.addEventListener('change', applyTheme)

type TextArea = HTMLElement & { value: string }
type Button = HTMLElement & { disabled: boolean }

const text = document.getElementById('qn-text') as TextArea
const save = document.getElementById('qn-save') as Button
const errorBar = document.getElementById('qn-error')!

const close = () => void invoke('quick_note_close')

function showError(message: string | null) {
  errorBar.textContent = message ?? ''
  errorBar.hidden = !message
}

async function submit() {
  const content = text.value.trim()
  if (!content || save.disabled) return
  save.disabled = true
  showError(null)
  try {
    await api.post('/api/desktop/notes', { content })
    close()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    showError(message === UNAUTHORIZED ? 'Bitte zuerst in FIB Desktop anmelden.' : message)
    save.disabled = false
  }
}

save.addEventListener('click', () => void submit())
document.getElementById('qn-cancel')!.addEventListener('click', close)
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close()
  else if (event.key === 'Enter' && event.ctrlKey) {
    event.preventDefault()
    void submit()
  }
})

// Gleich lostippen können – das Feld ist erst nach dem Registrieren fokussierbar.
void customElements.whenDefined('fluent-textarea').then(() => requestAnimationFrame(() => text.focus()))
