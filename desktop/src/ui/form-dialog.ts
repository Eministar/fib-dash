import { escapeHtml, errorText, selectValue, type DropdownElement } from '../dom'

// Ein Dialog für alle Formulare der App: Felder werden aus einer Beschreibung
// gebaut, damit jedes Formular gleich aussieht und sich gleich verhält.

export type Option = { value: string; label: string }

type Base = { name: string; label: string; required?: boolean; span?: 1 | 2; hint?: string }
export type Field =
  | (Base & { type: 'text' | 'textarea' | 'number'; value?: string | number | null; placeholder?: string; maxLength?: number })
  | (Base & { type: 'datetime'; value?: string | Date | null })
  | (Base & { type: 'select' | 'combobox'; options: Option[]; value?: string | null; placeholder?: string })
  | (Base & { type: 'checkbox'; value?: boolean })

export type Values = Record<string, string | boolean | null>

interface FormOptions {
  title: string
  description?: string
  /** Fertiges HTML über den Feldern (bereits escaped), z. B. für Verläufe. */
  html?: string
  /** Nur anzeigen: ein „Schließen“-Knopf, kein Speichern. */
  readOnly?: boolean
  fields: Field[]
  submitLabel?: string
  danger?: boolean
  /** Speichern; wirft bei Fehlern – die Meldung erscheint im Dialog. */
  onSubmit: (values: Values) => Promise<void>
}

type DialogElement = HTMLElement & { show(): void; hide(): void }
type Checkable = HTMLElement & { checked: boolean }
type Valued = HTMLElement & { value?: string }

function localInputValue(value: string | Date | null | undefined) {
  if (!value) return ''
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fieldHtml(field: Field, id: string) {
  const span = field.span === 2 || field.type === 'textarea' ? ' span-2' : ''
  const label = `<label slot="label" for="${id}">${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>`
  const hint = field.hint ? `<span slot="message" class="type-caption muted">${escapeHtml(field.hint)}</span>` : ''
  switch (field.type) {
    case 'textarea':
      return `<fluent-field class="${span}">${label}<fluent-textarea slot="input" id="${id}" resize="vertical" rows="4" placeholder="${escapeHtml(field.placeholder ?? '')}"></fluent-textarea>${hint}</fluent-field>`
    case 'datetime':
      return `<fluent-field class="${span}">${label}<input slot="input" class="native-input" type="datetime-local" id="${id}">${hint}</fluent-field>`
    case 'select':
    case 'combobox': {
      const options = field.options.map((o) => `<fluent-option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</fluent-option>`).join('')
      const type = field.type === 'combobox' ? 'type="combobox"' : ''
      return `<fluent-field class="${span}">${label}<fluent-dropdown slot="input" id="${id}" ${type} placeholder="${escapeHtml(field.placeholder ?? 'Auswählen …')}"><fluent-listbox>${options}</fluent-listbox></fluent-dropdown>${hint}</fluent-field>`
    }
    case 'checkbox':
      return `<div class="checkbox-field${span}"><fluent-checkbox id="${id}"></fluent-checkbox><label for="${id}">${escapeHtml(field.label)}</label></div>`
    default: {
      const type = field.type === 'number' ? 'type="number"' : ''
      const max = field.maxLength ? `maxlength="${field.maxLength}"` : ''
      return `<fluent-field class="${span}">${label}<fluent-text-input slot="input" id="${id}" ${type} ${max} placeholder="${escapeHtml(field.placeholder ?? '')}"></fluent-text-input>${hint}</fluent-field>`
    }
  }
}

function setInitial(field: Field, el: HTMLElement) {
  switch (field.type) {
    case 'datetime':
      ;(el as HTMLInputElement).value = localInputValue(field.value)
      break
    case 'select':
    case 'combobox':
      selectValue(el as DropdownElement, field.value ?? null)
      break
    case 'checkbox':
      ;(el as Checkable).checked = !!field.value
      break
    default:
      if (field.value !== undefined && field.value !== null) (el as Valued).value = String(field.value)
  }
}

function readValue(field: Field, el: HTMLElement): string | boolean | null {
  switch (field.type) {
    case 'datetime': {
      const raw = (el as HTMLInputElement).value
      return raw ? new Date(raw).toISOString() : null
    }
    case 'checkbox':
      return !!(el as Checkable).checked
    case 'select':
    case 'combobox':
      return (el as DropdownElement).value || null
    default:
      return ((el as Valued).value ?? '').trim() || null
  }
}

let counter = 0

/** Öffnet das Formular; `true`, wenn gespeichert wurde. */
export function openForm(options: FormOptions): Promise<boolean> {
  const dialog = document.getElementById('form-dialog') as DialogElement
  const prefix = `ff${++counter}`
  dialog.querySelector('.form-dialog-title')!.textContent = options.title
  const content = dialog.querySelector('.form-dialog-content') as HTMLElement
  const description = options.description ? `<p class="type-body muted form-description">${escapeHtml(options.description)}</p>` : ''
  const grid = options.fields.length
    ? `<form class="form-grid" novalidate>${options.fields.map((f) => fieldHtml(f, `${prefix}-${f.name}`)).join('')}<button type="submit" hidden></button></form>`
    : ''
  content.innerHTML = `${description}${options.html ?? ''}${grid}<fluent-message-bar intent="error" class="form-error" hidden></fluent-message-bar>`
  const elements = new Map(options.fields.map((f) => [f.name, content.querySelector<HTMLElement>(`#${prefix}-${f.name}`)!]))
  requestAnimationFrame(() => {
    for (const field of options.fields) setInitial(field, elements.get(field.name)!)
  })

  const submit = dialog.querySelector('.form-submit') as HTMLElement & { disabled: boolean }
  const cancel = dialog.querySelector('.form-cancel') as HTMLElement
  submit.textContent = options.submitLabel ?? 'Speichern'
  submit.hidden = !!options.readOnly
  cancel.textContent = options.readOnly ? 'Schließen' : 'Abbrechen'
  submit.classList.toggle('danger', !!options.danger)
  const errorBar = content.querySelector('.form-error') as HTMLElement

  return new Promise((resolve) => {
    let done = false
    const cleanup = () => {
      submit.removeEventListener('click', onSubmit)
      cancel.removeEventListener('click', onCancel)
      dialog.removeEventListener('toggle', onToggle)
    }
    const finish = (saved: boolean) => {
      if (done) return
      done = true
      cleanup()
      resolve(saved)
    }
    const onSubmit = async (event?: Event) => {
      event?.preventDefault()
      const values: Values = {}
      for (const field of options.fields) values[field.name] = readValue(field, elements.get(field.name)!)
      const missing = options.fields.find((f) => f.required && (values[f.name] === null || values[f.name] === ''))
      if (missing) {
        errorBar.textContent = `Bitte „${missing.label}“ ausfüllen.`
        errorBar.hidden = false
        return
      }
      submit.disabled = true
      errorBar.hidden = true
      try {
        await options.onSubmit(values)
        finish(true)
        dialog.hide()
      } catch (error) {
        errorBar.textContent = errorText(error)
        errorBar.hidden = false
      } finally {
        submit.disabled = false
      }
    }
    const onCancel = () => {
      finish(false)
      dialog.hide()
    }
    // Schließen per Esc, Kreuz oder Klick daneben zählt als Abbrechen.
    const onToggle = (event: Event) => {
      if ((event as unknown as CustomEvent<{ newState: string }>).detail?.newState === 'closed') finish(false)
    }
    submit.addEventListener('click', onSubmit)
    cancel.addEventListener('click', onCancel)
    dialog.addEventListener('toggle', onToggle)
    content.querySelector('form')?.addEventListener('submit', onSubmit)
    dialog.show()
  })
}

/** Rückfrage vor heiklen Aktionen wie Löschen. */
export function confirmAction(title: string, text: string, actionLabel = 'Löschen') {
  return openForm({ title, description: text, fields: [], submitLabel: actionLabel, danger: true, onSubmit: async () => {} })
}
