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
