import { api, query } from '../api'
import { $, errorText, escapeHtml } from '../dom'
import type { Sanction } from './model'

// Sanktion nach dem Sanktionskatalog ausstellen oder bearbeiten – wie im Dashboard:
// Penal Grade → Verstoß → Stufe, Wiederholungsprüfung, Umstände und der
// Entscheidungs-Check, der vollständig abgehakt sein muss.

interface Catalog {
  grades: {
    grade: string
    severity: string
    description: string
    typicalConsequence: string
    regularLevels: string[]
    repeatConsequence: string
    violations: { code: string; label: string }[]
  }[]
  levels: {
    level: string
    measure: string
    application: string
    suspends: boolean
    terminates: boolean
    demotes: boolean
    authorityLabel: string | null
    minRankName: string | null
    allowedForActor: boolean | null
  }[]
  mitigating: string[]
  aggravating: string[]
  checklist: { key: string; label: string }[]
}

interface RepeatAssessment {
  occurrence: number
  principle: string
  regularLevel: string
  recommendedLevel: string
  recommendedLevelLabel: string
  priors: { id: string; penalGrade: string; level: string; reason: string; createdAt: string }[]
}

type DialogElement = HTMLElement & { show(): void; hide(): void }

let catalog: Catalog | null = null

const form = {
  grade: '1',
  level: '01',
  violation: '',
  reason: '',
  penalty: '',
  suspensionHours: '48',
  mitigating: new Set<string>(),
  aggravating: new Set<string>(),
  checklist: new Set<string>(),
}
let repeat: RepeatAssessment | null = null
let target: { agentId: string; sanction: Sanction | null } | null = null
let resolve: ((saved: boolean) => void) | null = null
let busy = false

const gradeRule = () => catalog!.grades.find((g) => g.grade === form.grade) ?? catalog!.grades[0]
const levelRule = () => catalog!.levels.find((l) => l.level === form.level) ?? catalog!.levels[0]

function select(id: string, options: { value: string; label: string; disabled?: boolean }[], value: string) {
  return `<select class="native-input" id="${id}">${options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.value === value ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${escapeHtml(o.label)}</option>`)
    .join('')}</select>`
}

function checkboxes(group: string, items: string[] | { key: string; label: string }[], checked: Set<string>) {
  return items
    .map((item) => {
      const key = typeof item === 'string' ? item : item.key
      const label = typeof item === 'string' ? item : item.label
      return `<label class="sanction-check"><input type="checkbox" data-group="${group}" value="${escapeHtml(key)}"${checked.has(key) ? ' checked' : ''}><span>${escapeHtml(label)}</span></label>`
    })
    .join('')
}

function repeatHtml() {
  if (!form.violation) return '<p class="type-caption muted">Verstoß wählen, um die Wiederholungsprüfung zu sehen.</p>'
  if (!repeat) return '<p class="type-caption muted">Prüfe Vorverstöße …</p>'
  const priors = repeat.priors.length
    ? `<ul class="sanction-priors">${repeat.priors.map((p) => `<li>${escapeHtml(new Date(p.createdAt).toLocaleDateString('de-DE'))} · Stufe ${escapeHtml(p.level)} · ${escapeHtml(p.reason)}</li>`).join('')}</ul>`
    : ''
  const differs = repeat.recommendedLevel !== form.level
  return `
    <div class="sanction-repeat${repeat.occurrence > 1 ? ' warn' : ''}">
      <span class="type-body-strong">${repeat.occurrence > 1 ? `${repeat.occurrence}. Verstoß dieser Art` : 'Erstverstoß'}</span>
      <span class="type-caption">${escapeHtml(repeat.principle)} · Vorschlag: ${escapeHtml(repeat.recommendedLevelLabel)}</span>
      ${differs ? `<button type="button" class="link-button" data-use-level="${escapeHtml(repeat.recommendedLevel)}">Vorgeschlagene Stufe übernehmen</button>` : ''}
      ${priors}
    </div>`
}

function render() {
  if (!catalog) return
  const grade = gradeRule()
  const level = levelRule()
  const regular = new Set(grade.regularLevels)
  $('sanction-form').innerHTML = `
    <div class="sanction-grid">
      <label class="sanction-field"><span class="type-caption muted">Penal Grade</span>
        ${select('sf-grade', catalog.grades.map((g) => ({ value: g.grade, label: `Grade ${g.grade} · ${g.severity}` })), form.grade)}
      </label>
      <label class="sanction-field"><span class="type-caption muted">Verstoß</span>
        ${select('sf-violation', [{ value: '', label: 'Sonstiger Verstoß' }, ...grade.violations.map((v) => ({ value: v.code, label: v.label }))], form.violation)}
      </label>
      <p class="type-caption muted span-2">${escapeHtml(grade.description)} Typische Folge: ${escapeHtml(grade.typicalConsequence)}</p>
      <label class="sanction-field span-2"><span class="type-caption muted">Sanktionsstufe</span>
        ${select('sf-level', catalog.levels.map((l) => ({
          value: l.level,
          label: `${l.level} · ${l.measure}${regular.has(l.level) ? ' (Regelsanktion)' : ''}${l.allowedForActor === false ? ` – nur ${l.minRankName ?? l.authorityLabel ?? 'höhere Stelle'}` : ''}`,
          disabled: l.allowedForActor === false,
        })), form.level)}
      </label>
      <p class="type-caption muted span-2">${escapeHtml(level.application)}${level.authorityLabel ? ` Zuständig: ${escapeHtml(level.authorityLabel)}.` : ''}${level.terminates ? ' Beendet das Dienstverhältnis.' : ''}</p>
      <div class="span-2">${repeatHtml()}</div>
      <label class="sanction-field span-2"><span class="type-caption muted">Begründung *</span>
        <textarea class="native-input" id="sf-reason" rows="3">${escapeHtml(form.reason)}</textarea>
      </label>
      <label class="sanction-field span-2"><span class="type-caption muted">Folge / Auflage (optional)</span>
        <textarea class="native-input" id="sf-penalty" rows="2">${escapeHtml(form.penalty)}</textarea>
      </label>
      ${level.suspends ? `<label class="sanction-field"><span class="type-caption muted">Suspendierung (Stunden)</span><input class="native-input" id="sf-hours" type="number" min="1" value="${escapeHtml(form.suspensionHours)}"></label>` : ''}
    </div>
    <details class="sanction-section"${form.mitigating.size ? ' open' : ''}><summary class="type-body-strong">Mildernde Umstände</summary>${checkboxes('mitigating', catalog.mitigating, form.mitigating)}</details>
    <details class="sanction-section"${form.aggravating.size ? ' open' : ''}><summary class="type-body-strong">Erschwerende Umstände</summary>${checkboxes('aggravating', catalog.aggravating, form.aggravating)}</details>
    <div class="sanction-section"><span class="type-body-strong">Entscheidungs-Check (vollständig nötig)</span>${checkboxes('checklist', catalog.checklist, form.checklist)}</div>
    <fluent-message-bar intent="error" id="sanction-error" hidden></fluent-message-bar>`
  updateSubmit()
}

function complete() {
  return !!catalog && !!form.reason.trim() && catalog.checklist.every((item) => form.checklist.has(item.key))
}

function updateSubmit() {
  ;($('sanction-submit') as HTMLElement & { disabled: boolean }).disabled = busy || !complete()
}

async function loadRepeat() {
  repeat = null
  if (!form.violation || !target) return render()
  render()
  const checked = form.violation
  try {
    const result = await api.get<RepeatAssessment>(`/api/sanctions/repeat-check${query({
      agentId: target.agentId,
      penalGrade: form.grade,
      violationCode: form.violation,
      excludeSanctionId: target.sanction?.id ?? null,
    })}`)
    if (form.violation === checked) {
      repeat = result
      render()
    }
  } catch {
    // Ohne Prüfung bleibt der Hinweis „Prüfe Vorverstöße“ – Ausstellen geht trotzdem.
  }
}

function showError(message: string | null) {
  const bar = document.getElementById('sanction-error')
  if (!bar) return
  bar.textContent = message ?? ''
  bar.hidden = !message
}

async function submit() {
  if (!target || !complete() || busy) return
  busy = true
  updateSubmit()
  try {
    const body = {
      penalGrade: form.grade,
      level: form.level,
      violationCode: form.violation || null,
      reason: form.reason.trim(),
      penalty: form.penalty.trim(),
      checklist: Object.fromEntries(catalog!.checklist.map((item) => [item.key, form.checklist.has(item.key)])),
      mitigating: [...form.mitigating],
      aggravating: [...form.aggravating],
      ...(levelRule().suspends ? { suspensionHours: form.suspensionHours.trim() || null } : {}),
    }
    if (target.sanction) await api.patch(`/api/sanctions/${target.sanction.id}`, body)
    else await api.post('/api/sanctions', { ...body, agentId: target.agentId })
    close(true)
  } catch (error) {
    showError(errorText(error))
  } finally {
    busy = false
    updateSubmit()
  }
}

function close(saved: boolean) {
  ;($('sanction-dialog') as DialogElement).hide()
  resolve?.(saved)
  resolve = null
  target = null
}

/** Öffnet den Dialog; `true`, wenn ausgestellt bzw. gespeichert wurde. */
export async function openSanctionDialog(agentId: string, agentLabel: string, sanction: Sanction | null = null): Promise<boolean> {
  catalog ??= await api.get<Catalog>('/api/sanctions/catalog')
  const firstGrade = catalog.grades[0]
  Object.assign(form, {
    grade: sanction?.penalGrade ?? firstGrade.grade,
    level: sanction?.level ?? firstGrade.regularLevels[0] ?? '01',
    violation: sanction?.violationCode ?? '',
    reason: sanction?.reason ?? '',
    penalty: sanction?.penalty ?? '',
    suspensionHours: '48',
    mitigating: new Set<string>(),
    aggravating: new Set<string>(),
    // Der Entscheidungs-Check wird bei jeder Änderung neu bestätigt.
    checklist: new Set<string>(),
  })
  target = { agentId, sanction }
  $('sanction-dialog-title').textContent = sanction ? `Sanktion bearbeiten · ${agentLabel}` : `Sanktion ausstellen · ${agentLabel}`
  $('sanction-submit').textContent = sanction ? 'Speichern' : 'Ausstellen'
  render()
  void loadRepeat()
  ;($('sanction-dialog') as DialogElement).show()
  return new Promise((done) => (resolve = done))
}

export function initSanctionDialog() {
  const root = $('sanction-form')
  root.addEventListener('change', (event) => {
    const el = event.target as HTMLInputElement | HTMLSelectElement
    if (el.id === 'sf-grade') {
      // Grade-Wechsel: Stufe auf die Regelsanktion, Verstoß zurücksetzen (gehört immer zu einem Grade).
      form.grade = el.value
      form.level = gradeRule().regularLevels[0] ?? form.level
      form.violation = ''
      return void loadRepeat()
    }
    if (el.id === 'sf-violation') {
      form.violation = el.value
      return void loadRepeat()
    }
    if (el.id === 'sf-level') {
      form.level = el.value
      return render()
    }
    const group = (el as HTMLInputElement).dataset.group as 'mitigating' | 'aggravating' | 'checklist' | undefined
    if (group) {
      const set = form[group]
      if ((el as HTMLInputElement).checked) set.add(el.value)
      else set.delete(el.value)
      updateSubmit()
    }
  })
  root.addEventListener('input', (event) => {
    const el = event.target as HTMLInputElement | HTMLTextAreaElement
    if (el.id === 'sf-reason') form.reason = el.value
    else if (el.id === 'sf-penalty') form.penalty = el.value
    else if (el.id === 'sf-hours') form.suspensionHours = el.value
    else return
    updateSubmit()
  })
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-use-level]')
    if (!button) return
    form.level = button.dataset.useLevel!
    render()
  })
  $('sanction-submit').addEventListener('click', () => void submit())
  $('sanction-cancel').addEventListener('click', () => close(false))
  $('sanction-dialog').addEventListener('toggle', (event) => {
    if ((event as unknown as CustomEvent<{ newState: string }>).detail?.newState === 'closed' && resolve) {
      resolve(false)
      resolve = null
      target = null
    }
  })
}
