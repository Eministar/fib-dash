import { prisma } from './prisma'
import { ShareError } from './record-shares'
import { SHARE_KINDS, type ShareKind } from './record-share-validation'
import type { Prisma } from '@/generated/prisma'
import { DOSSIER_KINDS } from './dossiers'
import { INVESTIGATION_STATUS_LABELS, INVESTIGATION_ENTRY_KIND_LABELS, PERSON_LINK_TYPE_LABELS } from './investigations'

export type SharedItem = { kind: string; recordId: string; classifiedAtGrant: boolean }
type PublicClient = Pick<Prisma.TransactionClient, 'dossier' | 'person' | 'vehicle' | 'investigation' | 'bodycamClip' | 'investigationPhoto'>
export function requireSharedSelection<T extends { kind: string; recordId: string }>(items: T[], kind: string, id: string): T {
  const item = items.find(item => item.kind === kind && item.recordId === id)
  if (!item) throw new ShareError('Eintrag nicht freigegeben', 404)
  return item
}
/** Eine freigegebene Dauerakte gibt ihre Personen-, Einsatz- und Fahrzeugakten
 *  mit frei, jede freigegebene Einsatzakte ihre Bodycam-Clips. Verschlusssachen
 *  bleiben außen vor, solange sie nicht einzeln ausgewählt wurden. Ausdrücklich
 *  gewählte Einträge stehen vorne. */
export async function expandSharedItems(items: SharedItem[], client: PublicClient = prisma): Promise<SharedItem[]> {
  const result = [...items]
  const seen = new Set(items.map(item => `${item.kind}:${item.recordId}`))
  const add = (kind: ShareKind, recordId: string, classifiedAtGrant = false) => {
    if (seen.has(`${kind}:${recordId}`)) return
    seen.add(`${kind}:${recordId}`)
    result.push({ kind, recordId, classifiedAtGrant })
  }
  const dossierIds = items.filter(item => item.kind === 'DOSSIER').map(item => item.recordId)
  if (dossierIds.length) {
    const dossiers = await client.dossier.findMany({
      where: { id: { in: dossierIds } },
      select: { persons: { select: { id: true } }, investigations: { where: { classified: false }, select: { id: true } }, vehicles: { select: { id: true } } },
    })
    for (const d of dossiers) {
      d.investigations.forEach(r => add('CASE', r.id))
      d.persons.forEach(r => add('PERSON', r.id))
      d.vehicles.forEach(r => add('VEHICLE', r.id))
    }
  }
  // Clips erben die Freigabe ihrer Einsatzakte – inklusive VS-Freigabe.
  const cases = new Map(result.filter(item => item.kind === 'CASE').map(item => [item.recordId, item.classifiedAtGrant]))
  if (!cases.size) return result
  const clips = await client.bodycamClip.findMany({ where: { investigationId: { in: [...cases.keys()] } }, select: { id: true, investigationId: true }, orderBy: { recordedAt: 'asc' } })
  clips.forEach(clip => add('CLIP', clip.id, cases.get(clip.investigationId) ?? false))
  return result
}

export async function sharedHeading(item: SharedItem, client: PublicClient = prisma) {
  const id = item.recordId
  if (item.kind === 'DOSSIER') return (await client.dossier.findUnique({ where: { id }, select: { title: true } }))?.title ?? null
  if (item.kind === 'PERSON') { const p = await client.person.findUnique({ where: { id }, select: { personNumber: true, firstName: true, lastName: true } }); return p ? `${p.personNumber} · ${p.firstName} ${p.lastName}` : null }
  if (item.kind === 'VEHICLE') { const v = await client.vehicle.findUnique({ where: { id }, select: { vehicleNumber: true, model: true, plate: true } }); return v ? `${v.vehicleNumber} · ${v.plate ?? v.model ?? 'Fahrzeug'}` : null }
  if (item.kind === 'CASE') { const c = await client.investigation.findUnique({ where: { id }, select: { title: true, caseNumber: true, classified: true } }); return c && (!c.classified || item.classifiedAtGrant) ? `${c.caseNumber} · ${c.title}` : null }
  if (item.kind === 'CLIP') { const c = await client.bodycamClip.findUnique({ where: { id }, select: { title: true, investigation: { select: { classified: true } } } }); return c && (!c.investigation.classified || item.classifiedAtGrant) ? c.title : null }
  return null
}

type SharedPhoto = { id: string; title: string; filename: string; mimeType: string }
const PHOTO_SELECT = { id: true, title: true, filename: true, mimeType: true } as const

/** Alle Katalogbilder eines freigegebenen Eintrags, Titelbild zuerst. Externe
 *  URLs werden nie abgerufen – nur Katalogfotos dieses Eintrags. */
export async function sharedPhotos(item: SharedItem, client: PublicClient = prisma): Promise<SharedPhoto[]> {
  const id = item.recordId
  let photos: (SharedPhoto | null | undefined)[] = []
  if (item.kind === 'DOSSIER') {
    const d = await client.dossier.findUnique({ where: { id }, select: { photo: { select: PHOTO_SELECT }, photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } } } })
    photos = [d?.photo, ...(d?.photos ?? [])]
  } else if (item.kind === 'PERSON') {
    const p = await client.person.findUnique({ where: { id }, select: { photoUrl: true, photo: { select: PHOTO_SELECT } } })
    // Altbestände verweisen per `photoUrl` auf den Katalog.
    const legacyId = !p?.photo && /^\/api\/investigations\/photos\/([^/]+)\/image$/.exec(p?.photoUrl ?? '')?.[1]
    photos = [p?.photo ?? (legacyId ? await client.investigationPhoto.findUnique({ where: { id: legacyId }, select: PHOTO_SELECT }) : null)]
  } else if (item.kind === 'VEHICLE') {
    photos = [(await client.vehicle.findUnique({ where: { id }, select: { photo: { select: PHOTO_SELECT } } }))?.photo]
  } else if (item.kind === 'CASE') {
    photos = (await client.investigation.findUnique({ where: { id }, select: { photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } } } }))?.photos ?? []
  }
  const seen = new Set<string>()
  return photos.filter((photo): photo is SharedPhoto => !!photo && !seen.has(photo.id) && !!seen.add(photo.id))
}

export async function sharedPhoto(item: SharedItem, client: PublicClient = prisma) {
  return (await sharedPhotos(item, client))[0] ?? null
}

/** Verknüpfte Einträge, aber nur solche, die in derselben Freigabe stecken. */
async function sharedRelations(item: SharedItem, shared: SharedItem[], client: PublicClient) {
  const id = item.recordId
  const refs: { kind: ShareKind; recordId: string; relation?: string }[] = []
  const push = (kind: ShareKind, ids: string[]) => ids.forEach(recordId => refs.push({ kind, recordId }))
  const linkLabel = (type: string) => PERSON_LINK_TYPE_LABELS[type as keyof typeof PERSON_LINK_TYPE_LABELS] ?? type
  if (item.kind === 'DOSSIER') {
    const d = await client.dossier.findUnique({ where: { id }, select: { persons: { select: { id: true } }, investigations: { select: { id: true } }, vehicles: { select: { id: true } } } })
    push('PERSON', d?.persons.map(r => r.id) ?? []); push('CASE', d?.investigations.map(r => r.id) ?? []); push('VEHICLE', d?.vehicles.map(r => r.id) ?? [])
  } else if (item.kind === 'PERSON') {
    const p = await client.person.findUnique({ where: { id }, select: { dossiers: { select: { id: true } }, investigations: { select: { investigationId: true } }, vehiclesOwned: { select: { id: true } }, linksFrom: { select: { toPersonId: true, type: true } }, linksTo: { select: { fromPersonId: true, type: true } } } })
    p?.linksFrom.forEach(l => refs.push({ kind: 'PERSON', recordId: l.toPersonId, relation: linkLabel(l.type) }))
    p?.linksTo.forEach(l => refs.push({ kind: 'PERSON', recordId: l.fromPersonId, relation: linkLabel(l.type) }))
    push('DOSSIER', p?.dossiers.map(r => r.id) ?? []); push('CASE', p?.investigations.map(r => r.investigationId) ?? []); push('VEHICLE', p?.vehiclesOwned.map(r => r.id) ?? [])
  } else if (item.kind === 'VEHICLE') {
    const v = await client.vehicle.findUnique({ where: { id }, select: { ownerPersonId: true, dossiers: { select: { id: true } }, investigations: { select: { investigationId: true } } } })
    push('PERSON', v?.ownerPersonId ? [v.ownerPersonId] : []); push('DOSSIER', v?.dossiers.map(r => r.id) ?? []); push('CASE', v?.investigations.map(r => r.investigationId) ?? [])
  } else if (item.kind === 'CASE') {
    const c = await client.investigation.findUnique({ where: { id }, select: { dossiers: { select: { id: true } }, persons: { select: { personId: true } }, vehicles: { select: { vehicleId: true } }, clips: { select: { id: true } } } })
    push('DOSSIER', c?.dossiers.map(r => r.id) ?? []); push('PERSON', c?.persons.map(r => r.personId) ?? []); push('VEHICLE', c?.vehicles.map(r => r.vehicleId) ?? []); push('CLIP', c?.clips.map(r => r.id) ?? [])
  }
  const related = await Promise.all(refs.map(async ref => {
    const allowed = shared.find(s => s.kind === ref.kind && s.recordId === ref.recordId)
    const title = allowed && await sharedHeading(allowed, client)
    return title ? { kind: ref.kind, label: ref.relation ? `${SHARE_KINDS[ref.kind]} · ${ref.relation}` : SHARE_KINDS[ref.kind], recordId: ref.recordId, title } : null
  }))
  return related.filter(r => r !== null)
}

export async function publicRecord(item: SharedItem, client: PublicClient = prisma, shared: SharedItem[] = []) {
  const title = await sharedHeading(item, client)
  if (!title) throw new ShareError('Eintrag nicht verfügbar', 404)
  const id = item.recordId
  const fields: { label: string; value: string }[] = []
  const add = (label: string, value: string | boolean | Date | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') fields.push({ label, value: value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? value ? 'Ja' : 'Nein' : String(value) })
  }
  let entries: { title: string; content: string | null; occurredAt: Date; kind: string }[] = []
  if (item.kind === 'DOSSIER') {
    const d = await client.dossier.findUniqueOrThrow({ where: { id }, select: { kind: true, description: true, address: true } })
    add('Kategorie', DOSSIER_KINDS[d.kind as keyof typeof DOSSIER_KINDS] ?? d.kind); add('Adresse / Standort', d.address); add('Informationen', d.description)
  } else if (item.kind === 'PERSON') {
    const p = await client.person.findUniqueOrThrow({ where: { id }, select: { alias: true, identifier: true, dateOfBirth: true, phone: true, notes: true, wanted: true, dangerous: true } })
    add('Alias', p.alias); add('Kennung', p.identifier); add('Geburtsdatum', p.dateOfBirth?.toISOString().slice(0,10)); add('Telefon', p.phone); add('Gesucht', p.wanted); add('Gefährlich', p.dangerous); add('Notizen', p.notes)
  } else if (item.kind === 'VEHICLE') {
    const v = await client.vehicle.findUniqueOrThrow({ where: { id }, select: { model: true, color: true, plate: true, notes: true, stolen: true, wanted: true } })
    add('Modell', v.model); add('Kennzeichen', v.plate); add('Farbe', v.color); add('Gestohlen', v.stolen); add('Gesucht', v.wanted); add('Notizen', v.notes)
  } else if (item.kind === 'CASE') {
    const c = await client.investigation.findUniqueOrThrow({ where: { id }, select: { summary: true, status: true, entries: { select: { title: true, content: true, occurredAt: true, kind: true }, orderBy: { occurredAt: 'desc' } } } })
    add('Status', INVESTIGATION_STATUS_LABELS[c.status]); add('Zusammenfassung', c.summary)
    entries = c.entries.map(e => ({ title: e.title, content: e.content, occurredAt: e.occurredAt, kind: INVESTIGATION_ENTRY_KIND_LABELS[e.kind] }))
  } else {
    const c = await client.bodycamClip.findUniqueOrThrow({ where: { id }, select: { description: true, recordedAt: true, location: true, durationSeconds: true } })
    add('Beschreibung', c.description); add('Aufgenommen', c.recordedAt); add('Ort', c.location); add('Dauer (Sekunden)', c.durationSeconds)
  }
  const photos = (await sharedPhotos(item, client)).map(photo => ({ id: photo.id, title: photo.title }))
  const related = shared.length ? await sharedRelations(item, shared, client) : []
  return { kind: item.kind, label: SHARE_KINDS[item.kind as ShareKind], recordId: id, title, fields, entries, photos, related, hasPhoto: photos.length > 0, hasVideo: item.kind === 'CLIP' }
}
