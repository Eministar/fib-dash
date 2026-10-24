import { displayHotkey } from './format'

type InputElement = HTMLElement & { value: string }

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

/** KeyboardEvent.code → Tastenname, wie ihn Rust (clipper.rs / global-shortcut) versteht. */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Pause: 'Pause', PrintScreen: 'PrintScreen',
  }
  return named[code] ?? null
}

/**
 * Macht ein schreibgeschütztes Textfeld zum Tastenkürzel-Rekorder: hineinklicken
 * und die Kombination drücken. Esc bricht ab, Entf leert (nur bei `optional`).
 */
export function hotkeyInput(
  element: InputElement,
  options: { optional?: boolean; placeholder?: () => string; onChange: (hotkey: string) => void },
) {
  let current = ''

  const render = () => {
    element.value = current ? displayHotkey(current) : ''
    element.setAttribute('placeholder', options.placeholder?.() ?? '')
  }

  element.addEventListener('focusin', () => element.setAttribute('data-recording', ''))
  element.addEventListener('focusout', () => element.removeAttribute('data-recording'))
  element.addEventListener('keydown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.code === 'Escape') return element.blur()
    if (event.code === 'Delete' && options.optional && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      current = ''
      render()
      options.onChange('')
      return element.blur()
    }
    if (MODIFIER_CODES.has(event.code)) return
    const key = keyName(event.code)
    if (!key) return
    const parts = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Win', key].filter(Boolean)
    current = parts.join('+')
    render()
    options.onChange(current)
    element.blur()
  })

  return {
    set(value: string) {
      current = value
      render()
    },
  }
}
