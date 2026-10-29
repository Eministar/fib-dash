export type PhotoCrop = { x: number; y: number; zoom: number }
export const DEFAULT_CROP: PhotoCrop = { x: 50, y: 50, zoom: 1 }

export function parsePersonProfile(body: Record<string, unknown>) {
  const data: { occupation?: string | null; organization?: string | null; rank?: string | null; photoCrop?: PhotoCrop } = {}
  for (const key of ['occupation', 'organization', 'rank'] as const) {
    if (body[key] === undefined) continue
    if (body[key] !== null && typeof body[key] !== 'string') return 'Beruf, Organisation und Rang müssen Text sein.'
    const value = (body[key] as string | null)?.trim() || null
    if (value && value.length > 120) return 'Beruf, Organisation und Rang dürfen jeweils höchstens 120 Zeichen lang sein.'
    data[key] = value
  }
  if (body.photoCrop !== undefined) {
    const crop = body.photoCrop
    if (!crop || typeof crop !== 'object') return 'Ungültiger Bildausschnitt.'
    const { x, y, zoom } = crop as PhotoCrop
    if (![x, y, zoom].every(v => typeof v === 'number' && Number.isFinite(v)) || x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 3) return 'Ungültiger Bildausschnitt.'
    data.photoCrop = { x, y, zoom }
  }
  return data
}

/** Positionsangaben bleiben bei Zoom und verschiedenen Avatargrößen proportional. */
export function cropStyle(crop: PhotoCrop = DEFAULT_CROP) {
  return { objectPosition: `${crop.x}% ${crop.y}%`, transform: `scale(${crop.zoom})`, transformOrigin: `${crop.x}% ${crop.y}%` }
}

export function dragCrop(crop: PhotoCrop, dx: number, dy: number, size: number, width: number, height: number): PhotoCrop {
  const scale = size / Math.min(width, height) * crop.zoom
  const move = (position: number, delta: number, overflow: number) => overflow > 0 ? Math.min(100, Math.max(0, position - delta / overflow * 100)) : position
  return { ...crop, x: move(crop.x, dx, width * scale - size), y: move(crop.y, dy, height * scale - size) }
}
