import { api } from '../api'
import { $, errorText, escapeHtml, initials, textOf, type ValueElement } from '../dom'
import { can } from '../store'
import { openForm, type Field } from '../ui/form-dialog'
import { toast } from '../ui/toast'
import { loadList } from './list'
import { invalidate, personOptions } from './lookups'
import { personName, type Person, type Vehicle } from './model'
import { cropStyle, DEFAULT_CROP, dragCrop, type PhotoCrop } from '../../../src/lib/investigations/person-profile'

let active: 'cases' | 'persons' | 'vehicles' = 'cases'
let revision = 0
let rows: (Person | Vehicle)[] = []
let dialogBusy = false
export const registerActive = () => active !== 'cases'
const photoPath = (id: string) => `/api/investigations/photos/${encodeURIComponent(id)}/image`
const info = (label: string, value?: string | null) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || 'Nicht erfasst')}</dd></div>`

function portrait(item: Person | Vehicle) {
  const person = 'firstName' in item ? item : null
  const src = item.photoId ? photoPath(item.photoId) : person?.photoUrl
  const crop = person?.photoCrop ?? DEFAULT_CROP
  return `<span class="register-photo ${person ? 'round' : ''}"><span>${person ? escapeHtml(initials(personName(person))) : 'Kein Foto'}</span>${src ? `<img data-register-photo="${escapeHtml(src)}" alt="${escapeHtml(person ? personName(person) : (item as Vehicle).plate || 'Fahrzeug')}" style="object-position:${crop.x}% ${crop.y}%;transform:scale(${crop.zoom});transform-origin:${crop.x}% ${crop.y}%">` : ''}</span>`
}

async function loadImages(root: HTMLElement) {
  await Promise.all([...root.querySelectorAll<HTMLImageElement>('img[data-register-photo]')].map(async image => {
    const path = image.dataset.registerPhoto!
    try {
      const src = path.startsWith('/api/') ? await api.image(path) : path.startsWith('https://') ? path : ''
      if (!src) { image.remove(); return }
      image.onerror = () => image.remove()
      image.src = src
    } catch { image.remove() }
  }))
}

function card(item: Person | Vehicle) {
  const person = 'firstName' in item ? item : null
  const vehicle = person ? null : item as Vehicle
  const warning = item.wanted ? '<span class="pill tone-danger">Fahndung</span>' : ''
  const other = person?.dangerous ? '<span class="pill tone-warning">Gefährlich</span>' : vehicle?.stolen ? '<span class="pill tone-danger">Gestohlen</span>' : ''
  const properties = person
    ? info('Beruf / Tätigkeit', person.occupation) + info('Rang / Position', person.rank) + info('Organisation / Arbeitgeber', person.organization) + info('Telefon', person.phone)
    : info('Modell', vehicle!.model) + info('Farbe', vehicle!.color) + info('Halter', vehicle!.ownerPerson ? personName(vehicle!.ownerPerson) : 'Unbekannt')
  return `<article class="card register-card"><div class="register-heading">${portrait(item)}<div><h2 class="type-subtitle">${escapeHtml(person ? personName(person) : vehicle!.plate || 'Kennzeichen nicht erfasst')}</h2><p class="type-caption muted">${escapeHtml(person ? person.personNumber : vehicle!.vehicleNumber)}</p><div class="case-badges">${warning}${other}${!warning && !other ? '<span class="type-caption muted">Keine Warnhinweise erfasst</span>' : ''}</div></div></div><dl class="register-facts">${properties}</dl><div class="register-actions"><fluent-button data-edit="${item.id}">${can('investigations:manage') ? 'Bearbeiten' : 'Details anzeigen'}</fluent-button>${can('investigations:manage') ? `<fluent-button data-photo-edit="${item.id}">${person ? 'Profilbild / Ausschnitt' : 'Fahrzeugfoto'}</fluent-button>` : ''}</div></article>`
}

export async function loadRegister() {
  if (!registerActive()) return
  const request = ++revision
  const kind = active
  $('register-new').hidden = !can('investigations:manage')
  try {
    const items = await api.get<(Person | Vehicle)[]>(`/api/${kind}?search=${encodeURIComponent(textOf('register-search'))}`)
    if (request !== revision || active !== kind) return
    const flagged = ($('register-flagged') as HTMLElement & { checked: boolean }).checked
    rows = items.filter(item => !flagged || item.wanted || ('firstName' in item ? item.dangerous : item.stolen))
    $('register-list').innerHTML = rows.length ? rows.map(card).join('') : '<p class="muted">Keine Einträge gefunden. Ändere die Suche oder lege einen neuen Eintrag an.</p>'
    $('register-count').textContent = `${rows.length} ${kind === 'persons' ? 'Personen' : 'Fahrzeuge'}`
    $('register-error').hidden = true
    void loadImages($('register-list'))
  } catch (error) {
    if (request !== revision) return
    $('register-error').textContent = errorText(error)
    $('register-error').hidden = false
  }
}

async function editItem(item?: Person | Vehicle) {
  const kind = active
  if (kind === 'cases') return
  if (!can('investigations:manage')) {
    if (item) await openForm({ title: 'Registereintrag', readOnly: true, html: `<dl class="register-facts">${info('Notizen', item.notes)}${'firstName' in item ? info('Alias', item.alias) + info('Ausweis / Kennung', item.identifier) : ''}</dl>`, fields: [], onSubmit: async () => {} })
    return
  }
  const fields: Field[] = kind === 'persons' ? [
    { name: 'firstName', label: 'Vorname', type: 'text', required: true, maxLength: 100 },
    { name: 'lastName', label: 'Nachname', type: 'text', required: true, maxLength: 100 },
    { name: 'occupation', label: 'Beruf / Tätigkeit', type: 'text', maxLength: 120 },
    { name: 'organization', label: 'Organisation / Arbeitgeber', type: 'text', maxLength: 120 },
    { name: 'rank', label: 'Rang / Position', type: 'text', maxLength: 120, hint: 'Position in der Organisation, nicht die Rolle in einer Ermittlung.' },
    { name: 'alias', label: 'Alias', type: 'text' },
    { name: 'identifier', label: 'Ausweis / Kennung', type: 'text' },
    { name: 'phone', label: 'Telefon', type: 'text' },
    { name: 'dangerous', label: 'Als gefährlich eingestuft', type: 'checkbox' },
  ] : [
    { name: 'plate', label: 'Kennzeichen', type: 'text' },
    { name: 'model', label: 'Modell', type: 'text' },
    { name: 'color', label: 'Farbe', type: 'text' },
    { name: 'ownerPersonId', label: 'Halter', type: 'combobox', options: await personOptions() },
    { name: 'stolen', label: 'Als gestohlen gemeldet', type: 'checkbox' },
  ]
  fields.push({ name: 'wanted', label: 'Zur Fahndung ausgeschrieben', type: 'checkbox' }, { name: 'notes', label: 'Notizen', type: 'textarea' })
  if (item) for (const field of fields) {
    const value = (item as unknown as Record<string, string | boolean | null>)[field.name]
    if (field.type === 'checkbox') field.value = value === true
    else field.value = typeof value === 'string' ? value : null
  }
  const saved = await openForm({ title: `${kind === 'persons' ? 'Person' : 'Fahrzeug'} ${item ? 'bearbeiten' : 'anlegen'}`, description: 'Nicht bekannte Angaben können leer bleiben. Fotos bearbeitest du anschließend am Registereintrag.', fields, onSubmit: async values => {
    if (kind === 'vehicles' && !values.plate && !values.model) throw new Error('Bitte Kennzeichen oder Modell angeben.')
    if (item) await api.patch(`/api/${kind}/${item.id}`, values)
    else await api.post(`/api/${kind}`, values)
    invalidate(kind)
    toast('Registereintrag gespeichert')
  } })
  if (saved) await loadRegister()
}

async function editPhoto(item: Person | Vehicle) {
  if (!can('investigations:manage')) return
  const kind = 'firstName' in item ? 'persons' : 'vehicles'
  let photoId = item.photoId ?? null
  let source = photoId ? photoPath(photoId) : 'firstName' in item ? item.photoUrl : null
  let crop: PhotoCrop = { ...('firstName' in item ? item.photoCrop ?? DEFAULT_CROP : DEFAULT_CROP) }
  let page = 1
  let photoRequest = 0
  let imageRequest = 0
  let imageReady = false
  let closed = false
  const saved = openForm({ title: kind === 'persons' ? 'Profilbild und Ausschnitt' : 'Fahrzeugfoto', description: 'Bild aus dem gemeinsamen Bildkatalog wählen. Neue Bilder können im Dashboard hochgeladen werden.', fields: [], html: `
    <div class="register-photo-editor"><div id="register-crop" class="register-crop ${kind === 'persons' ? 'round' : ''}"><img id="register-crop-image" alt="Bildausschnitt" draggable="false"></div>
    <div id="register-crop-controls" ${kind === 'vehicles' ? 'hidden' : ''}><p>Bild im Kreis verschieben oder die Regler verwenden.</p>${(['zoom', 'x', 'y'] as const).map(key => `<label class="register-slider">${{ zoom: 'Zoom', x: 'Horizontal', y: 'Vertikal' }[key]}<input id="register-crop-${key}" type="range" min="${key === 'zoom' ? 1 : 0}" max="${key === 'zoom' ? 3 : 100}" step="${key === 'zoom' ? 0.01 : 1}" value="${crop[key]}"></label>`).join('')}<fluent-button id="register-crop-reset">Ausschnitt zurücksetzen</fluent-button></div></div>
    <p id="register-photo-error" role="alert"></p><fluent-button id="register-photo-remove">Foto entfernen</fluent-button>
    <div class="toolbar"><input id="register-photo-search" class="native-input" aria-label="Bildkatalog durchsuchen" placeholder="Bildtitel suchen"><fluent-button id="register-photo-find">Suchen</fluent-button></div>
    <div id="register-photo-catalog" class="register-photo-catalog"></div><div class="toolbar"><fluent-button id="register-photo-prev">Zurück</fluent-button><span id="register-photo-page"></span><fluent-button id="register-photo-next">Weiter</fluent-button></div>`, onSubmit: async () => {
      await api.patch(`/api/${kind}/${item.id}`, { photoId, ...(kind === 'persons' ? { photoUrl: photoId ? null : source, photoCrop: crop } : {}) })
      invalidate(kind)
      toast('Foto gespeichert')
    } })
  const image = $<HTMLImageElement>('register-crop-image')
  const paint = () => {
    Object.assign(image.style, kind === 'persons' ? cropStyle(crop) : {})
    for (const key of ['zoom', 'x', 'y'] as const) $<HTMLInputElement>(`register-crop-${key}`).value = String(crop[key])
  }
  const preview = async () => {
    const request = ++imageRequest
    imageReady = false
    image.hidden = true
    image.onload = () => { imageReady = true; image.hidden = false }
    image.onerror = () => { $('register-photo-error').textContent = 'Bild konnte nicht geladen werden.' }
    paint()
    if (!source) return
    try {
      const src = source.startsWith('/api/') ? await api.image(source) : source
      if (request !== imageRequest || closed) return
      image.src = src
    } catch (error) { if (!closed) $('register-photo-error').textContent = errorText(error) }
  }
  const catalog = async () => {
    const request = ++photoRequest
    try {
      const data = await api.get<{ items: { id: string; title: string }[]; total: number }>(`/api/investigations/photos?search=${encodeURIComponent($<HTMLInputElement>('register-photo-search').value)}&page=${page}`)
      if (request !== photoRequest || closed) return
      $('register-photo-catalog').innerHTML = data.items.length ? data.items.map(photo => `<button type="button" data-pick-photo="${photo.id}"><img data-register-photo="${photoPath(photo.id)}" alt=""><span>${escapeHtml(photo.title)}</span></button>`).join('') : '<p>Keine Bilder gefunden.</p>'
      $('register-photo-page').textContent = `Seite ${page}`
      ;($('register-photo-prev') as HTMLElement & { disabled: boolean }).disabled = page === 1
      ;($('register-photo-next') as HTMLElement & { disabled: boolean }).disabled = page * 30 >= data.total
      void loadImages($('register-photo-catalog'))
    } catch (error) { if (!closed) $('register-photo-error').textContent = errorText(error) }
  }
  for (const key of ['zoom', 'x', 'y'] as const) $(`register-crop-${key}`).addEventListener('input', () => { crop[key] = Number($<HTMLInputElement>(`register-crop-${key}`).value); paint() })
  let drag: { x: number; y: number; crop: PhotoCrop } | null = null
  $('register-crop').addEventListener('pointerdown', event => { if (!imageReady || kind !== 'persons') return; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, crop: { ...crop } } })
  $('register-crop').addEventListener('pointermove', event => { if (drag) { crop = dragCrop(drag.crop, event.clientX - drag.x, event.clientY - drag.y, 180, image.naturalWidth, image.naturalHeight); paint() } })
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) $('register-crop').addEventListener(event, () => { drag = null })
  $('register-crop-reset').addEventListener('click', () => { crop = { ...DEFAULT_CROP }; paint() })
  $('register-photo-remove').addEventListener('click', () => { photoId = null; source = null; crop = { ...DEFAULT_CROP }; void preview() })
  $('register-photo-catalog').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-pick-photo]')
    if (!button) return
    photoId = button.dataset.pickPhoto!
    source = photoPath(photoId)
    crop = { ...DEFAULT_CROP }
    void preview()
  })
  $('register-photo-find').addEventListener('click', () => { page = 1; void catalog() })
  $('register-photo-search').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); page = 1; void catalog() } })
  $('register-photo-prev').addEventListener('click', () => { page--; void catalog() })
  $('register-photo-next').addEventListener('click', () => { page++; void catalog() })
  void preview()
  void catalog()
  const result = await saved
  closed = true
  if (result) await loadRegister()
}

async function runDialog(task: () => Promise<void>) {
  if (dialogBusy) return
  dialogBusy = true
  try { await task() } catch (error) { toast(errorText(error), 'error') } finally { dialogBusy = false }
}

export function initRegisters() {
  $('register-navigation').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-register]')
    if (!button) return
    active = button.dataset.register as typeof active
    revision++
    $('register-view').hidden = active === 'cases'
    $('inv-list-view').hidden = active !== 'cases'
    $('inv-detail-view').hidden = true
    for (const item of $('register-navigation').querySelectorAll('[data-register]')) {
      item.setAttribute('appearance', item === button ? 'primary' : 'subtle')
      item.setAttribute('aria-pressed', String(item === button))
    }
    $<ValueElement>('register-search').value = ''
    $('register-title').textContent = active === 'persons' ? 'Personenregister' : 'Fahrzeugregister'
    $('register-description').textContent = active === 'persons' ? 'Personen mit Beruf, Organisation, Rang und Profilbild.' : 'Kennzeichen, Modell, Farbe und Halter auf einen Blick.'
    if (active === 'cases') void loadList()
    else { $('register-list').innerHTML = ''; void loadRegister() }
  })
  let timer: number | undefined
  $('register-search').addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => void loadRegister(), 250) })
  $('register-flagged').addEventListener('change', () => void loadRegister())
  $('register-new').addEventListener('click', () => void runDialog(() => editItem()))
  $('register-list').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-edit], [data-photo-edit]')
    if (!button) return
    const item = rows.find(row => row.id === (button.dataset.edit || button.dataset.photoEdit))
    if (item) void runDialog(() => button.dataset.photoEdit ? editPhoto(item) : editItem(item))
  })
}
