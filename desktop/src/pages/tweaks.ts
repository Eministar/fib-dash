import {
  backend,
  type InputDevice,
  type PollingResult,
  type RestoreResult,
  type TweakId,
  type TweakReport,
  type TweakState,
  type WasdDetails,
  type WasdStatus,
} from '../backend'
import { $, errorText, escapeHtml } from '../dom'
import { icon, type IconName } from '../icons'
import { openForm } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { startResources } from './resources'

// „Weitere Sachen → Tweaks“. Alle Systemeingriffe laufen im Rust-Backend; diese
// Seite zeigt nur dessen Zustand und schickt Tweak-IDs. Schalter spiegeln immer
// den zuletzt gemeldeten Backend-Zustand – es gibt keine eigene Wahrheit hier.

let status: WasdStatus | null = null
let details: WasdDetails | null = null
let devices: InputDevice[] | null = null
let polling: PollingResult[] | null = null
let measuring = false
let view: 'overview' | 'details' = 'overview'
/** Läuft gerade ein Vorgang aus dieser Seite? */
let working = false

type Switch = HTMLElement & { checked: boolean; disabled: boolean }

const STATE: Record<TweakState, { label: string; tone: string }> = {
  inactive: { label: 'Aus', tone: 'subtle' },
  active: { label: 'Aktiv', tone: 'success' },
  partiallyActive: { label: 'Teilweise aktiv', tone: 'warning' },
  applying: { label: 'Wird angewendet …', tone: 'brand' },
  restoring: { label: 'Wird wiederhergestellt …', tone: 'brand' },
  pendingRestart: { label: 'Neustart ausstehend', tone: 'warning' },
  unsupported: { label: 'Nicht unterstützt', tone: 'subtle' },
  error: { label: 'Fehler', tone: 'danger' },
  diagnostic: { label: 'Nur Anzeige', tone: 'subtle' },
}

const isOn = (state: TweakState) => state === 'active' || state === 'pendingRestart' || state === 'partiallyActive'
const isBusy = (state: TweakState) => state === 'applying' || state === 'restoring'

function pill(state: TweakState) {
  const s = STATE[state]
  return `<span class="pill tone-${s.tone}">${s.label}</span>`
}

function badge(text: string, tone: string, iconName?: IconName) {
  return `<span class="pill tone-${tone}">${iconName ? icon(iconName) : ''}${escapeHtml(text)}</span>`
}

function switchHtml(id: string, checked: boolean, disabled: boolean, label: string) {
  return `<fluent-switch id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="${escapeHtml(label)}"></fluent-switch>`
}

// ── Laden ────────────────────────────────────────────────────────────

async function load() {
  try {
    if (view === 'details') {
      details = await backend.tweaksDetails()
      status = details.status
    } else {
      status = await backend.tweaksStatus()
    }
    $('tw-error').hidden = true
  } catch (error) {
    $('tw-error').textContent = `Tweaks konnten nicht gelesen werden: ${errorText(error)}`
    $('tw-error').hidden = false
  }
  render()
}

function render() {
  $('tw-overview').hidden = view !== 'overview'
  $('tw-details').hidden = view !== 'details'
  if (view === 'overview') renderOverview()
  else renderDetails()
}

// ── Übersicht ────────────────────────────────────────────────────────

function mainSwitchHtml(id: string) {
  const s = status!
  // Gesperrt, solange nichts aktiv ist – Ausschalten (Wiederherstellen) bleibt immer möglich.
  const blocked = s.blockedByRules && !isOn(s.state)
  return switchHtml(id, isOn(s.state), working || isBusy(s.state) || s.state === 'unsupported' || blocked, 'WASD Tweak ein- oder ausschalten')
}

function rulesNotice(s: WasdStatus) {
  const blocked = s.blockedByRules
    ? `<p class="tw-hint danger type-caption">${icon('shieldError')}<span><strong>Auf NERO-V nicht erlaubt.</strong> Mausbeschleunigung und Tastenwiederholung verändern Eingaben – das verbietet das Regelwerk (§ 4.5, § 6.2). Der Haupt-Schalter bleibt deshalb aus.</span></p>`
    : ''
  const deviations = s.forbiddenDeviations.length
    ? `<p class="tw-hint warning type-caption">${icon('warning')}<span>Bei dir weichen vom Windows-Standard ab: ${escapeHtml(s.forbiddenDeviations.join(', '))} (z. B. durch ein früheres Tweak-Skript). In den Details kannst du den Windows-Standard herstellen – gesichert und rückgängig zu machen.</span></p>`
    : ''
  return blocked + deviations
}

function statusLine(s: WasdStatus) {
  return `${pill(s.state)}<span class="type-caption muted">${s.activeCount} von ${s.profileCount} Einstellungen aktiv${s.managedCount ? ` · ${s.managedCount} gesicherte Originalwerte` : ''}</span>`
}

function renderOverview() {
  const grid = $('tw-cards')
  if (!status) {
    grid.innerHTML = '<div class="card empty">Wird geladen …</div>'
    return
  }
  const s = status
  grid.innerHTML = `
    <article class="card tw-card">
      <div class="tw-card-head">
        <span class="tw-card-icon">${icon('wasd')}</span>
        <div class="tw-card-title">
          <span class="type-subtitle">WASD Tweak</span>
          <span class="type-caption muted">Keyboard &amp; Mouse Optimization</span>
        </div>
        ${mainSwitchHtml('tw-main-switch')}
      </div>
      <p class="type-body">Optimierung und Konfiguration der Windows-Eingabeverarbeitung für Maus und Tastatur mit Fokus auf FiveM.</p>
      <div class="tw-status">${statusLine(s)}</div>
      ${rulesNotice(s)}
      <div class="chips">${s.features.map((f) => `<span class="chip">${escapeHtml(f)}</span>`).join('')}</div>
      ${s.adminFeatures.length ? `<p class="tw-hint type-caption">${icon('shieldError')}<span>${escapeHtml(s.adminFeatures.join(', '))} ${s.adminFeatures.length === 1 ? 'braucht' : 'brauchen'} Administratorrechte – Windows fragt beim Einschalten nach. Der Haupt-Schalter selbst braucht keine.</span></p>` : ''}
      ${s.pendingRestart ? `<p class="tw-hint warning type-caption">${icon('arrowSync')}<span>Neustart ausstehend: Eine Änderung wird erst nach dem nächsten Windows-Neustart wirksam.</span></p>` : ''}
      ${s.error ? `<p class="tw-hint danger type-caption">${icon('errorCircle')}<span>${escapeHtml(s.error)}</span></p>` : ''}
      <div class="tw-card-actions">
        <fluent-button id="tw-open-details" appearance="primary">Details</fluent-button>
      </div>
    </article>`
}

// ── Haupt-Schalter ───────────────────────────────────────────────────

async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
  working = true
  render()
  try {
    return await work()
  } catch (error) {
    toast(errorText(error), 'error')
    return undefined
  } finally {
    working = false
    await load()
  }
}

function changesTable(rows: { setting: string; current: string; target: string; unchanged?: boolean; tweakName?: string }[]) {
  return `<div class="tw-table preview">
    <div class="tw-row head"><span>Einstellung</span><span>Aktuell</span><span>Danach</span></div>
    ${rows
      .map(
        (r) => `<div class="tw-row${r.unchanged ? ' muted' : ''}">
          <span>${r.tweakName ? `<strong>${escapeHtml(r.tweakName)}</strong><br>` : ''}${escapeHtml(r.setting)}</span>
          <span>${escapeHtml(r.current)}</span>
          <span>${r.unchanged ? 'bleibt (schon so eingestellt)' : escapeHtml(r.target)}</span>
        </div>`,
      )
      .join('')}
  </div>`
}

async function enableMain() {
  let preview
  try {
    preview = await backend.tweaksPreview()
  } catch (error) {
    return toast(errorText(error), 'error')
  }
  await openForm({
    title: 'WASD Tweak einschalten',
    description: 'Diese Einstellungen werden geändert. Die Originalwerte werden vorher gesichert; Experimentelles bleibt aus.',
    html: changesTable(preview),
    fields: [],
    submitLabel: 'Anwenden',
    onSubmit: async () => {
      working = true
      try {
        const result = await backend.tweaksApplyProfile()
        toast(result.written ? `WASD Tweak aktiv – ${result.written} Einstellung(en) geändert.` : 'WASD Tweak aktiv – alles war schon so eingestellt.')
      } finally {
        working = false
      }
    },
  })
  await load()
}

/** Wiederherstellen mit Rückfrage, falls andere Programme Werte geändert haben. */
async function restoreWithConflicts(title: string, restore: (force: boolean) => Promise<RestoreResult>) {
  const result = await run(() => restore(false))
  if (!result) return
  if (result.failures.length) toast(`Nicht wiederhergestellt: ${result.failures.join(' · ')}`, 'error')
  if (!result.conflicts.length) {
    if (result.restored) toast('Originalwerte wiederhergestellt.')
    return
  }
  await openForm({
    title,
    description: 'Diese Werte hat ein anderes Programm nach der App geändert. Sie wurden deshalb nicht angefasst.',
    html: `<ul class="tw-list">${result.conflicts.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`,
    fields: [],
    submitLabel: 'Trotzdem Originalwerte setzen',
    danger: true,
    onSubmit: async () => {
      const forced = await restore(true)
      toast(`${forced.restored} Einstellung(en) auf die Originalwerte gesetzt.`)
    },
  })
  await load()
}

async function onMainSwitch() {
  if (!status) return
  const want = !isOn(status.state)
  render() // Schalter zeigt bis zur Antwort weiter den echten Zustand.
  if (want) await enableMain()
  else await restoreWithConflicts('WASD Tweak ausschalten', (force) => backend.tweaksRestoreProfile(force))
}

// ── Einzelne Tweaks ──────────────────────────────────────────────────

async function enableTweak(report: TweakReport) {
  const { meta } = report
  const elevation = report.needsElevation ? ' Windows fragt danach nach Administratorrechten.' : ''
  const ticket = meta.serverRule.status === 'ticketRequired'
  if (meta.ownRisk || ticket) {
    // Benutzung auf eigene Gefahr / Ticket-Freigabe: immer erst bestätigen (das Backend prüft es zusätzlich).
    const notices = [
      ticket
        ? `<div class="tw-risk">${icon('shieldError')}<div><strong>NERO-V: nur mit Ticket-Freigabe (${escapeHtml(meta.serverRule.paragraphs)})</strong><p>${escapeHtml(meta.serverRule.reason)}</p></div></div>`
        : '',
      meta.ownRisk ? `<div class="tw-risk">${icon('warning')}<div><strong>Benutzung auf eigene Gefahr</strong><p>${escapeHtml(meta.riskNotice ?? '')}</p></div></div>` : '',
    ].join('')
    await openForm({
      title: `${meta.name} einschalten`,
      html: notices,
      description: `Die Originalwerte werden gesichert und lassen sich jederzeit wiederherstellen.${elevation}`,
      fields: [
        {
          name: 'accept',
          label: ticket
            ? 'Das Analyseteam hat mir das per Ticket freigegeben, und ich schalte es auf eigene Gefahr ein.'
            : 'Ich habe die Warnung gelesen und schalte das auf eigene Gefahr ein.',
          type: 'checkbox',
          span: 2,
        },
      ],
      submitLabel: 'Auf eigene Gefahr einschalten',
      danger: true,
      onSubmit: async (values) => {
        if (values.accept !== true) throw new Error('Bitte die Warnung bestätigen – sonst bleibt alles, wie es ist.')
        await backend.tweakApply(meta.id, true)
        toast(meta.needsRestart ? `${meta.name} gesetzt – wirksam nach dem nächsten Neustart.` : `${meta.name} eingeschaltet.`)
      },
    })
    await load()
    return
  }
  await run(async () => {
    const result = await backend.tweakApply(meta.id, false)
    toast(result.written ? `${meta.name} eingeschaltet.` : `${meta.name}: war schon so eingestellt.`)
  })
}

async function resetToDefault(report: TweakReport) {
  await openForm({
    title: `${report.meta.name}: Windows-Standard herstellen`,
    description:
      'Setzt die Werte auf den Stand einer frischen Windows-Installation. Der jetzige Zustand wird vorher gesichert – „Originalwerte wiederherstellen“ macht es rückgängig.',
    html: changesTable(
      report.settings
        .filter((row) => row.target !== null)
        .map((row) => ({ setting: row.label, current: row.current, target: 'Windows-Standard' })),
    ),
    fields: [],
    submitLabel: 'Windows-Standard herstellen',
    onSubmit: async () => {
      await backend.tweakResetDefault(report.meta.id)
      toast(`${report.meta.name}: Windows-Standard hergestellt.`)
    },
  })
  await load()
}

async function onTweakSwitch(id: TweakId) {
  const report = details?.tweaks.find((t) => t.meta.id === id)
  if (!report) return
  const want = !isOn(report.state)
  render()
  if (want) await enableTweak(report)
  else await restoreWithConflicts(`${report.meta.name} ausschalten`, (force) => backend.tweakRestore(id, force))
}

async function restoreAll() {
  await openForm({
    title: 'Alle Änderungen rückgängig machen',
    description:
      'Alle Einstellungen, die die App verändert hat, werden auf die gesicherten Originalwerte zurückgesetzt. Was die App nicht verändert hat, bleibt unberührt.',
    fields: [],
    submitLabel: 'Originalwerte wiederherstellen',
    danger: true,
    onSubmit: async () => {},
  }).then(async (confirmed) => {
    if (confirmed) await restoreWithConflicts('Alle Änderungen rückgängig machen', (force) => backend.tweaksRestoreAll(force))
  })
}

// ── Details ──────────────────────────────────────────────────────────

const KIND: Record<TweakReport['meta']['kind'], [string, string]> = {
  toggle: ['Einstellung', 'brand'],
  experimental: ['Experimentell', 'warning'],
  diagnostic: ['Diagnose', 'subtle'],
  inGame: ['Nur im Spiel', 'subtle'],
}
const RULE: Record<TweakReport['meta']['serverRule']['status'], [string, string, IconName]> = {
  allowed: ['NERO-V: erlaubt', 'success', 'checkmarkCircle'],
  ticketRequired: ['NERO-V: nur mit Ticket', 'warning', 'shieldError'],
  forbidden: ['NERO-V: verboten', 'danger', 'shieldError'],
}

const RISK: Record<TweakReport['meta']['risk'], [string, string] | null> = {
  none: null,
  low: ['Risiko gering', 'success'],
  medium: ['Risiko mittel', 'warning'],
}

function tweakSection(report: TweakReport) {
  const { meta } = report
  const forbidden = meta.serverRule.status === 'forbidden'
  // Verbotenes lässt sich nicht einschalten; war es von der App an, bleibt Ausschalten möglich.
  const switchable = (meta.kind === 'toggle' || meta.kind === 'experimental') && report.state !== 'unsupported' && (!forbidden || isOn(report.state))
  const risk = RISK[meta.risk]
  const rule = RULE[meta.serverRule.status]
  const notes = [
    meta.serverRule.status !== 'allowed' || meta.kind === 'experimental'
      ? `<p class="tw-hint ${forbidden ? 'danger' : 'warning'} type-caption">${icon('shieldError')}<span>NERO-V ${escapeHtml(meta.serverRule.paragraphs)}: ${escapeHtml(meta.serverRule.reason)}</span></p>`
      : '',
    report.windowsDefaultSet
      ? `<p class="tw-hint type-caption">${icon('checkmarkCircle')}<span>Die App hat hier den Windows-Standard hergestellt. „Originalwerte wiederherstellen“ macht das rückgängig.</span></p>`
      : '',
    forbidden && report.deviatesFromDefault
      ? `<p class="tw-hint warning type-caption">${icon('warning')}<span>Weicht vom Windows-Standard ab – vermutlich durch ein früheres Tweak-Programm.</span></p>`
      : '',
    report.unsupported ? `<p class="tw-hint type-caption">${icon('info')}<span>${escapeHtml(report.unsupported)}</span></p>` : '',
    report.externalChange ? `<p class="tw-hint warning type-caption">${icon('warning')}<span>Ein anderes Programm hat diese Werte nach der App geändert.</span></p>` : '',
    report.alreadyAtTarget && !report.managed ? `<p class="tw-hint type-caption">${icon('checkmarkCircle')}<span>Windows ist schon so eingestellt – Einschalten ändert nichts, sichert aber den Zustand.</span></p>` : '',
    report.needsElevation && switchable ? `<p class="tw-hint type-caption">${icon('shieldError')}<span>Braucht Administratorrechte – Windows fragt beim Umschalten nach.</span></p>` : '',
    report.state === 'pendingRestart' ? `<p class="tw-hint warning type-caption">${icon('arrowSync')}<span>Wirksam nach dem nächsten Windows-Neustart.</span></p>` : '',
    report.error ? `<p class="tw-hint danger type-caption">${icon('errorCircle')}<span>${escapeHtml(report.error)}</span></p>` : '',
  ].join('')
  return `
    <section class="card tw-tweak" data-tweak="${meta.id}">
      <div class="tw-tweak-head">
        <div class="tw-tweak-title">
          <span class="type-body-strong">${escapeHtml(meta.name)}</span>
          <span class="tw-badges">
            ${pill(report.state)}
            ${badge(KIND[meta.kind][0], KIND[meta.kind][1])}
            ${risk ? badge(risk[0], risk[1]) : ''}
            ${badge(rule[0], rule[1], rule[2])}
            ${meta.ownRisk ? badge('Benutzung auf eigene Gefahr', 'danger', 'warning') : ''}
            ${meta.inProfile ? badge('Teil des WASD Tweaks', 'brand') : ''}
          </span>
        </div>
        ${switchable ? switchHtml(`tw-switch-${meta.id}`, isOn(report.state), working || isBusy(report.state) || (forbidden && !isOn(report.state)), meta.name) : ''}
        ${meta.hasWindowsDefault && report.deviatesFromDefault && !isOn(report.state) ? `<fluent-button data-tw-default="${meta.id}" ${working ? 'disabled' : ''}>Windows-Standard herstellen</fluent-button>` : ''}
      </div>
      <p class="type-body muted">${escapeHtml(meta.description)}</p>
      ${notes}
      ${
        report.settings.length
          ? `<div class="tw-table">
              <div class="tw-row head"><span>Wert</span><span>Aktuell</span><span>Ziel</span></div>
              ${report.settings
                .map(
                  (row) => `<div class="tw-row">
                    <span>${escapeHtml(row.label)}${row.note ? `<span class="type-caption muted">${escapeHtml(row.note)}</span>` : ''}</span>
                    <span class="tw-value">${escapeHtml(row.current)}</span>
                    <span class="tw-value">${row.target ? escapeHtml(row.target) : '<span class="muted">–</span>'}</span>
                  </div>`,
                )
                .join('')}
            </div>`
          : ''
      }
      <details class="tw-explain">
        <summary>${icon('info')}Technische Einordnung</summary>
        <ul>${report.explanation.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </details>
    </section>`
}

const CONNECTION: Record<InputDevice['connection'], string> = {
  usb: 'USB / Funk-Empfänger',
  bluetooth: 'Bluetooth',
  ps2: 'PS/2',
  virtual: 'Virtuell',
  unknown: 'Unbekannt',
}

function devicesSection() {
  const list = devices
  const rows = list
    ? list.length
      ? list
          .map(
            (d) => `<div class="tw-row device">
              <span><span class="type-body-strong">${escapeHtml(d.name)}</span><span class="type-caption muted">${d.kind === 'mouse' ? 'Maus' : 'Tastatur'}${d.manufacturer ? ` · ${escapeHtml(d.manufacturer)}` : ''}${d.note ? ` · ${escapeHtml(d.note)}` : ''}</span></span>
              <span>${CONNECTION[d.connection]}</span>
              <span class="tw-value">${escapeHtml(d.driver ?? '–')}</span>
              <span class="tw-value truncate" title="${escapeHtml(d.hardwareId ?? '')}">${escapeHtml(d.vendorId && d.productId ? `VID ${d.vendorId} · PID ${d.productId}` : (d.hardwareId ?? '–'))}</span>
            </div>`,
          )
          .join('')
      : '<div class="empty small">Keine Maus oder Tastatur gefunden.</div>'
    : '<div class="empty small">Wird gelesen …</div>'
  const measured = polling
    ? polling.length
      ? polling
          .map(
            (p) => `<div class="tw-row">
              <span class="type-body-strong">${escapeHtml(p.device)}</span>
              <span class="tw-value">${p.measuredHz ? `${p.measuredHz} Hz gemessen` : '–'}</span>
              <span class="tw-value">${p.nominalHz ? `≈ ${p.nominalHz} Hz` : escapeHtml(p.note ?? '')}</span>
            </div>`,
          )
          .join('')
      : '<div class="empty small">Keine Bewegung erkannt – Maus während der Messung bewegen.</div>'
    : ''
  return `
    <section class="card tw-tweak">
      <div class="tw-tweak-head">
        <div class="tw-tweak-title"><span class="type-body-strong">Eingabegeräte</span><span class="tw-badges">${badge('Diagnose', 'subtle')}</span></div>
        <fluent-button id="tw-measure" ${measuring ? 'disabled' : ''}>${icon('gauge').replace('<i ', '<i slot="start" ')}${measuring ? 'Maus jetzt bewegen …' : 'Abfragerate messen'}</fluent-button>
      </div>
      <div class="tw-table devices">
        <div class="tw-row head device"><span>Gerät</span><span>Verbindung</span><span>Treiber</span><span>Hardware</span></div>
        ${rows}
      </div>
      ${measuring ? '<p class="tw-hint type-caption">' + icon('cursor') + '<span>3 Sekunden lang die Maus gleichmäßig bewegen …</span></p>' : ''}
      ${measured ? `<div class="tw-table"><div class="tw-row head"><span>Gemessene Abfragerate</span><span>Messung</span><span>Übliche Rate</span></div>${measured}</div>` : ''}
    </section>`
}

function fivemGuide() {
  return `
    <section class="card tw-tweak">
      <div class="tw-tweak-title"><span class="type-body-strong">So stellst du es in FiveM ein</span></div>
      <ol class="tw-steps type-body">
        <li>FiveM starten, im Spiel <kbd>Esc</kbd> → <strong>Einstellungen</strong> → <strong>Tastatur/Maus</strong> öffnen.</li>
        <li><strong>Maus-Eingabemethode</strong> (Profilwert 750) auf <strong>Raw Input</strong> stellen. Dann wirken Windows-Beschleunigung und Zeigergeschwindigkeit nicht mehr auf das Zielen.</li>
        <li><strong>Empfindlichkeit</strong> (754) nach Gefühl einstellen – sie gilt nur im Spiel.</li>
        <li>Falls angeboten: <strong>Mausglättung</strong> (761) auf den niedrigsten Wert – Glättung mittelt Bewegungen und fühlt sich träger an.</li>
      </ol>
      <p class="type-caption muted">Die App liest oder ändert diese Werte nicht: Sie sind nur im Spiel zugänglich, und von außen ginge es nur über Eingriffe in den Spielprozess – das macht die App bewusst nicht.</p>
    </section>`
}

const GROUPS: { key: TweakReport['meta']['category']; title: string; icon: IconName; extra?: () => string }[] = [
  { key: 'mouse', title: 'Maus', icon: 'cursor' },
  { key: 'keyboard', title: 'Tastatur', icon: 'wasd' },
  { key: 'system', title: 'System', icon: 'board', extra: devicesSection },
  { key: 'fivem', title: 'FiveM', icon: 'games', extra: fivemGuide },
]

/** Welche Gruppen aufgeklappt sind, bleibt beim Neuzeichnen erhalten. */
const open = new Set(['mouse', 'keyboard'])

function renderDetails() {
  const root = $('tw-details')
  if (!details || !status) {
    root.innerHTML = '<div class="card empty">Wird geladen …</div>'
    return
  }
  const s = status
  root.innerHTML = `
    <nav class="breadcrumb" aria-label="Pfad">
      <button class="crumb" data-tw="back">Tweaks</button>
      <span class="crumb-sep">${icon('chevronRight')}</span>
      <span class="crumb current">WASD Tweak</span>
    </nav>
    <article class="card tw-card tw-hero">
      <div class="tw-card-head">
        <span class="tw-card-icon">${icon('wasd')}</span>
        <div class="tw-card-title">
          <span class="type-subtitle">WASD Tweak</span>
          <span class="type-caption muted">Keyboard &amp; Mouse Optimization</span>
        </div>
        ${mainSwitchHtml('tw-main-switch')}
      </div>
      <div class="tw-status">${statusLine(s)}</div>
      ${rulesNotice(s)}
      <p class="type-caption muted">Der Haupt-Schalter setzt nur die risikoarmen Einstellungen „${s.items.map((i) => escapeHtml(i.name)).join('“ und „')}“. Experimentelles und „auf eigene Gefahr“ schaltest du unten einzeln – jeweils mit Bestätigung.</p>
      ${s.adminFeatures.length ? `<p class="tw-hint type-caption">${icon('shieldError')}<span>Administratorrechte nötig für: ${escapeHtml(s.adminFeatures.join(', '))}. ${s.isAdmin ? 'Die App läuft als Administrator.' : 'Windows fragt beim Umschalten nach.'}</span></p>` : ''}
      ${s.pendingRestart ? `<p class="tw-hint warning type-caption">${icon('arrowSync')}<span>Neustart ausstehend.</span></p>` : ''}
      ${s.error ? `<p class="tw-hint danger type-caption">${icon('errorCircle')}<span>${escapeHtml(s.error)}</span></p>` : ''}
      <div class="tw-card-actions">
        <fluent-button id="tw-restore-all" ${s.managedCount && !working ? '' : 'disabled'}>${icon('arrowUndo').replace('<i ', '<i slot="start" ')}Originalwerte wiederherstellen</fluent-button>
        <span class="type-caption muted tw-backup" title="${escapeHtml(details.backupPath)}">Sicherung: ${escapeHtml(details.backupPath)}</span>
      </div>
    </article>
    <p class="type-caption muted tw-disclaimer">${icon('info')}Die Einstellungen sorgen für ein gleichmäßigeres, vorhersehbares Eingabeverhalten. Mehr FPS, bessere Hitreg oder messbar weniger Latenz verspricht die App ausdrücklich nicht.</p>
    ${GROUPS.map((group) => {
      const items = details!.tweaks.filter((t) => t.meta.category === group.key)
      const active = items.filter((t) => isOn(t.state)).length
      const switchable = items.filter((t) => t.meta.kind === 'toggle' || t.meta.kind === 'experimental').length
      return `
        <details class="card tw-group" data-group="${group.key}" ${open.has(group.key) ? 'open' : ''}>
          <summary>
            <span class="tw-group-icon">${icon(group.icon)}</span>
            <span class="type-body-strong">${group.title}</span>
            <span class="type-caption muted">${switchable ? `${active} von ${switchable} aktiv` : 'Hinweise'}</span>
            <span class="spacer"></span>
            <span class="tw-chevron">${icon('chevronRight')}</span>
          </summary>
          <div class="tw-group-body">
            ${items.map(tweakSection).join('')}
            ${group.extra ? group.extra() : ''}
          </div>
        </details>`
    }).join('')}`
}

async function measure() {
  measuring = true
  polling = null
  render()
  try {
    polling = await backend.measurePolling(3)
  } catch (error) {
    toast(errorText(error), 'error')
  } finally {
    measuring = false
    render()
  }
}

async function openDetails() {
  view = 'details'
  render()
  await load()
  if (!devices) {
    devices = await backend.inputDevices().catch(() => [])
    render()
  }
}

// ── Start ────────────────────────────────────────────────────────────

export function initTweaks() {
  const page = document.querySelector<HTMLElement>('[data-page="tweaks"]')!
  page.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    if (target.closest('#tw-open-details')) void openDetails()
    else if (target.closest('[data-tw="back"]')) {
      view = 'overview'
      void load()
    } else if (target.closest('#tw-restore-all')) void restoreAll()
    else if (target.closest('#tw-measure') && !measuring) void measure()
    else if (target.closest('[data-tw-default]')) {
      const id = target.closest<HTMLElement>('[data-tw-default]')!.dataset.twDefault as TweakId
      const report = details?.tweaks.find((t) => t.meta.id === id)
      if (report) void resetToDefault(report)
    }
  })
  // Schalter: Zustand kommt immer vom Backend, der Klick löst nur den Vorgang aus.
  page.addEventListener('change', (event) => {
    const target = event.target as Switch
    if (target.id === 'tw-main-switch') void onMainSwitch()
    else if (target.id.startsWith('tw-switch-')) void onTweakSwitch(target.id.slice('tw-switch-'.length) as TweakId)
  })
  page.addEventListener('toggle', (event) => {
    const group = (event.target as HTMLElement).closest<HTMLDetailsElement>('details.tw-group')
    if (group?.dataset.group) (group.open ? open.add(group.dataset.group) : open.delete(group.dataset.group))
  }, true)
}

export function showTweaks() {
  void load()
  startResources()
}
