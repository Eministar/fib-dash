const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

export function formatDateTime(date: Date) {
  return dateTime.format(date)
}

/** Titel eines Clips: immer Datum und Uhrzeit der Aufnahme. */
export function clipTitle(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())} Uhr`
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return 'unbekannt'
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')} min`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} GB`
}

/** „Strg+Umschalt+B" für die Anzeige; gespeichert wird „Ctrl+Shift+B". */
export function displayHotkey(hotkey: string) {
  return hotkey.replace(/\bCtrl\b/g, 'Strg').replace(/\bShift\b/g, 'Umschalt')
}

/** 0:07, 1:05, 12:30 – für Player und Ausschnitt. */
export function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** Dienstzeit wie „12 Std. 05 Min.“ bzw. „45 Min.“. */
export function formatHours(ms: number) {
  const minutes = Math.round(ms / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} Std. ${String(m).padStart(2, '0')} Min.` : `${m} Min.`
}

const relative = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' })

export function formatAgo(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  return relative.format(-Math.round(hours / 24), 'day')
}
