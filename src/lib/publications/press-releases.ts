export const PRESS_RELEASE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const

export type PressReleaseStatusValue = (typeof PRESS_RELEASE_STATUSES)[number]

export const PRESS_RELEASE_STATUS_META: Record<PressReleaseStatusValue, { label: string; tone: string }> = {
  DRAFT: { label: 'Entwurf', tone: 'text-[#fbbf24] bg-[#fbbf24]/12 border-[#fbbf24]/25' },
  PUBLISHED: { label: 'Veröffentlicht', tone: 'text-[#34d399] bg-[#34d399]/12 border-[#34d399]/25' },
  ARCHIVED: { label: 'Archiviert', tone: 'text-[#a6a6a6] bg-[#232323] border-[#404040]' },
}

export interface PressReleaseInput {
  title: string
  summary: string | null
  content: string
  imageUrl: string | null
  imageAlt: string | null
  status: PressReleaseStatusValue
}

export function normalizePressReleaseStatus(value: unknown): PressReleaseStatusValue {
  return PRESS_RELEASE_STATUSES.includes(value as PressReleaseStatusValue)
    ? value as PressReleaseStatusValue
    : 'DRAFT'
}

function cleanOptionalText(value: unknown, maxLength?: number) {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+\n/g, '\n').trim()
  if (!clean) return null
  return typeof maxLength === 'number' ? clean.slice(0, maxLength) : clean
}

export function normalizePressReleaseInput(body: unknown): { data: PressReleaseInput | null; error: string | null } {
  const source = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const title = cleanOptionalText(source.title, 180)
  const content = cleanOptionalText(source.content)
  if (!title) return { data: null, error: 'Titel ist erforderlich' }
  if (!content) return { data: null, error: 'Inhalt ist erforderlich' }

  const imageUrl = cleanOptionalText(source.imageUrl)
  if (imageUrl && !imageUrl.startsWith('/uploads/') && !/^https?:\/\//i.test(imageUrl)) {
    return { data: null, error: 'Bild muss eine Upload-URL oder eine http(s)-URL sein' }
  }

  return {
    data: {
      title,
      summary: cleanOptionalText(source.summary, 500),
      content,
      imageUrl,
      imageAlt: cleanOptionalText(source.imageAlt, 180),
      status: normalizePressReleaseStatus(source.status),
    },
    error: null,
  }
}

export function slugifyPressReleaseTitle(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70)

  return slug || 'pressemitteilung'
}

export function pressReleaseExcerpt(content: string, maxLength = 180) {
  const clean = content.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trim()}…`
}
