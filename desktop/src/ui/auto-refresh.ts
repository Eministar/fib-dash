// Seiten mit Daten vom Dashboard regelmäßig nachladen – aber nur, solange die App im
// Vordergrund ist und die Seite offen ist. Liegt die App hinter anderen Fenstern, im
// Tray oder minimiert, wird nichts geladen (Leistung im Spiel).

/** So oft wird nachgeladen, solange die Seite offen ist. */
const REFRESH_MS = 30_000

/** Während ein Dialog offen ist, nichts unter ihm austauschen. */
function dialogOpen() {
  return [...document.querySelectorAll('fluent-dialog')].some(
    (dialog) => dialog.hasAttribute('open') || !!(dialog.shadowRoot?.querySelector('dialog') as HTMLDialogElement | null)?.open,
  )
}

/** Wer gerade tippt, verliert sonst seine Eingabe beim Neuzeichnen. */
function typing(page: HTMLElement) {
  const active = document.activeElement
  if (!active || !page.contains(active)) return false
  return active.matches('input, textarea, select, fluent-text-input, fluent-textarea, [contenteditable="true"]')
}

/**
 * `route` ist der Name der Seite (`data-page`). `refresh` lädt still nach – ohne
 * Meldungen, Fehler werden beim nächsten Durchlauf erneut versucht.
 */
export function autoRefresh(route: string, refresh: () => Promise<unknown>) {
  let running = false
  const run = async () => {
    const page = document.querySelector<HTMLElement>(`.page[data-page="${route}"]`)
    // Auch die übergeordnete Ansicht zählt – auf dem Anmeldebildschirm lädt nichts.
    if (running || !page || page.closest('[hidden]')) return
    if (document.visibilityState !== 'visible' || !document.hasFocus() || dialogOpen() || typing(page)) return
    running = true
    try {
      await refresh()
    } catch {
      // Beim nächsten Durchlauf erneut versuchen.
    } finally {
      running = false
    }
  }
  window.setInterval(() => void run(), REFRESH_MS)
  // Zurück im Fenster: gleich den aktuellen Stand holen.
  window.addEventListener('focus', () => void run())
}
