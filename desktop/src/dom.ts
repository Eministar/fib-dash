// Kleine DOM-Helfer für alle Seiten.

export type ValueElement = HTMLElement & { value: string }
export type DropdownElement = HTMLElement & { value: string | null }
export type ButtonElement = HTMLElement & { disabled: boolean }
export type ProgressElement = HTMLElement & { value?: number }

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

/** Text eines Eingabefelds – Fluent-Felder liefern vor der ersten Eingabe `undefined`. */
export function textOf(id: string) {
  return (($(id) as ValueElement).value ?? '').trim()
}

export function showMessage(id: string, text: string | null) {
  const bar = $(id)
  bar.textContent = text ?? ''
  bar.hidden = !text
}

export function fillOptions(listId: string, options: { id: string; label: string }[]) {
  $(listId).replaceChildren(
    ...options.map(({ id, label }) => {
      const option = document.createElement('fluent-option')
      option.setAttribute('value', id)
      option.textContent = label
      return option
    }),
  )
}

/**
 * Setzt den Wert eines Fluent-Dropdowns. Solange dessen Template oder die frisch
 * eingefügten Optionen noch nicht stehen, wirft der Setter – dann im nächsten
 * Frame erneut versuchen (im Release-Build ist der Start schneller als im Dev-Modus).
 */
export function selectValue(dropdown: DropdownElement, value: string | null | undefined, attempts = 30) {
  if (!value) return
  try {
    dropdown.value = value
    if (dropdown.value === value) return
  } catch {
    // Noch nicht bereit.
  }
  if (attempts > 0) requestAnimationFrame(() => selectValue(dropdown, value, attempts - 1))
}

export function initials(name: string) {
  const words = name.replace(/\[[^\]]*\]/g, '').replace(/^Agent\s+/i, '').trim().split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
