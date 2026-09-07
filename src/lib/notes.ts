const NOTE_TITLE_MAX_LENGTH = 191

export function cleanNoteContent(value: unknown) {
  if (typeof value !== 'string') return null
  const content = value.trim()
  return content || null
}

export function cleanNoteTitle(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return null

  const title = value.trim()
  if (!title) return null
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    throw new Error(`Titel darf maximal ${NOTE_TITLE_MAX_LENGTH} Zeichen lang sein.`)
  }

  return title
}

export function cleanNotePinned(value: unknown) {
  return value === true
}
