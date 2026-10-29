import { api } from '../api'
import { errorText, escapeHtml } from '../dom'
import { icon } from '../icons'
import { can } from '../store'
import { createCityMap, type MapPin } from './city-map'
import { MAP_CATEGORIES, mapCategory } from '../../../src/lib/investigations/map-spots'

// Ortswahl auf der Stadtkarte: vorhandene Punkte per Klick an- oder abwählen,
// mit Kartenrecht per Klick auf freie Fläche einen neuen Ort anlegen.

export type Spot = {
  id: string
  title: string
  category: string
  icon: string | null
  x: number
  y: number
  investigations?: { id: string; caseNumber: string; title: string }[]
  dossiers?: { id: string; title: string }[]
}

interface PickOptions {
  title: string
  description: string
  selected: string[]
  /** Kategorie, die für neue Orte vorgewählt ist. */
  defaultCategory?: string
}

export function spotPin(spot: Spot, selected = false): MapPin {
  const category = mapCategory(spot.category)
  return { id: spot.id, x: spot.x, y: spot.y, color: category.hex, glyph: spot.icon || category.icon, label: `${spot.title} · ${category.label}`, selected }
}

/** Liefert die gewählten Punkt-IDs oder `null` bei Abbruch. */
export function pickMapSpots(options: PickOptions): Promise<string[] | null> {
  const manage = can('map:manage')
  const dialog = document.createElement('dialog')
  dialog.className = 'map-dialog'
  dialog.innerHTML = `
    <header class="map-dialog-header">
      <div><h2 class="type-subtitle">${escapeHtml(options.title)}</h2><p class="type-caption muted">${escapeHtml(options.description)}</p></div>
      <button type="button" class="map-dialog-close" data-close aria-label="Schließen">${icon('dismiss')}</button>
    </header>
    <div class="map-dialog-body">
      <div class="map-dialog-map"></div>
      <aside class="map-dialog-side">
        <form class="map-new" hidden>
          <h3 class="type-body-strong">Neuer Ort</h3>
          <label class="map-field"><span class="type-caption muted">Bezeichnung</span><input name="title" class="native-input" maxlength="80" required placeholder="z. B. Lagerhalle Hafen"></label>
          <label class="map-field"><span class="type-caption muted">Kategorie</span><select name="category" class="native-input">${MAP_CATEGORIES.map((c) => `<option value="${c.id}"${c.id === (options.defaultCategory ?? 'other') ? ' selected' : ''}>${c.icon} ${escapeHtml(c.label)}</option>`).join('')}</select></label>
          <div class="map-new-actions"><fluent-button type="button" data-cancel-new>Verwerfen</fluent-button><fluent-button type="submit" appearance="primary">Ort anlegen</fluent-button></div>
        </form>
        <label class="map-field"><span class="type-caption muted">Gewählt</span></label>
        <div class="map-selected chips"></div>
        <input class="native-input map-search" type="search" placeholder="Ort suchen" aria-label="Ort suchen">
        <div class="map-spot-list" role="list"></div>
        <p class="type-caption muted map-hint">${manage ? 'Nadel anklicken zum Auswählen – Klick auf freie Fläche legt einen neuen Ort an.' : 'Nadel anklicken zum Auswählen.'}</p>
      </aside>
    </div>
    <p class="map-dialog-error" role="alert" hidden></p>
    <footer class="map-dialog-footer"><fluent-button data-close>Abbrechen</fluent-button><fluent-button appearance="primary" data-save>Übernehmen</fluent-button></footer>`
  document.body.append(dialog)

  const selected = new Set(options.selected)
  let spots: Spot[] = []
  const $ = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!
  const showError = (text: string | null) => {
    $('.map-dialog-error').textContent = text ?? ''
    $('.map-dialog-error').hidden = !text
  }

  const map = createCityMap($('.map-dialog-map'), {
    onPin: (id) => {
      selected.has(id) ? selected.delete(id) : selected.add(id)
      render()
    },
    onPlace: manage
      ? (position) => {
          map.setPending(position)
          pending = position
          $('.map-new').hidden = false
          $<HTMLInputElement>('.map-new input[name="title"]').focus()
        }
      : undefined,
  })
  let pending: { x: number; y: number } | null = null

  function render() {
    map.setPins(spots.map((spot) => spotPin(spot, selected.has(spot.id))))
    const chosen = spots.filter((spot) => selected.has(spot.id))
    $('.map-selected').innerHTML = chosen.length
      ? chosen.map((spot) => `<button type="button" class="chip" data-toggle="${spot.id}" title="Abwählen"><span class="map-dot" style="background:${mapCategory(spot.category).hex}"></span>${escapeHtml(spot.title)}${icon('dismiss')}</button>`).join('')
      : '<span class="type-caption muted">Noch kein Ort gewählt.</span>'
    const term = $<HTMLInputElement>('.map-search').value.trim().toLowerCase()
    const matches = spots.filter((spot) => !term || spot.title.toLowerCase().includes(term) || mapCategory(spot.category).label.toLowerCase().includes(term)).slice(0, 60)
    $('.map-spot-list').innerHTML = matches
      .map(
        (spot) => `<button type="button" class="map-spot-row${selected.has(spot.id) ? ' selected' : ''}" role="listitem" data-toggle="${spot.id}">
          <span class="map-dot" style="background:${mapCategory(spot.category).hex}"></span>
          <span class="map-spot-text"><span class="truncate">${escapeHtml(spot.title)}</span><span class="type-caption muted truncate">${escapeHtml(mapCategory(spot.category).label)}${spot.investigations?.length ? ` · ${spot.investigations.length} Akten` : ''}</span></span>
          ${selected.has(spot.id) ? icon('checkmarkCircle') : ''}
        </button>`,
      )
      .join('') || '<p class="type-caption muted">Kein Ort gefunden.</p>'
  }

  return new Promise((resolve) => {
    let result: string[] | null = null
    dialog.addEventListener('close', () => {
      dialog.remove()
      resolve(result)
    })
    dialog.addEventListener('click', (event) => {
      const target = event.target as Element
      if (target === dialog || target.closest('[data-close]')) return dialog.close()
      if (target.closest('[data-save]')) {
        result = [...selected]
        return dialog.close()
      }
      if (target.closest('[data-cancel-new]')) {
        pending = null
        map.setPending(null)
        $('.map-new').hidden = true
        return
      }
      const toggle = target.closest<HTMLElement>('[data-toggle]')?.dataset.toggle
      if (toggle) {
        const wasSelected = selected.has(toggle)
        wasSelected ? selected.delete(toggle) : selected.add(toggle)
        if (!wasSelected) map.focus(toggle)
        render()
      }
    })
    $('.map-search').addEventListener('input', render)
    $<HTMLFormElement>('.map-new').addEventListener('submit', async (event) => {
      event.preventDefault()
      if (!pending) return
      const form = new FormData(event.target as HTMLFormElement)
      try {
        const spot = await api.post<Spot>('/api/map/spots', { title: String(form.get('title') ?? '').trim(), category: form.get('category'), ...pending })
        spots = [spot, ...spots]
        selected.add(spot.id)
        pending = null
        map.setPending(null)
        $('.map-new').hidden = true
        ;(event.target as HTMLFormElement).reset()
        showError(null)
        render()
      } catch (error) {
        showError(errorText(error))
      }
    })

    dialog.showModal()
    api
      .get<Spot[]>('/api/map/spots')
      .then((list) => {
        spots = list
        render()
        const first = options.selected[0]
        if (first) requestAnimationFrame(() => map.focus(first))
      })
      .catch((error) => showError(`Karte konnte nicht geladen werden: ${errorText(error)}`))
  })
}
