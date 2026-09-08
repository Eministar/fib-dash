import { prisma } from './prisma'
import { ShareError } from './record-shares'
import { SHARE_KINDS, type ShareKind } from './record-share-validation'
import type { Prisma } from '@/generated/prisma'
import { DOSSIER_KINDS } from './dossiers'
import { INVESTIGATION_STATUS_LABELS, INVESTIGATION_ENTRY_KIND_LABELS } from './investigations'

export type SharedItem = { kind: string; recordId: string; classifiedAtGrant: boolean }
type PublicClient = Pick<Prisma.TransactionClient, 'dossier' | 'person' | 'vehicle' | 'investigation' | 'bodycamClip' | 'investigationPhoto'>
export function requireSharedSelection<T extends { kind: string; recordId: string }>(items: T[], kind: string, id: string): T {
  const item = items.find(item => item.kind === kind && item.recordId === id)
  if (!item) throw new ShareError('Eintrag nicht freigegeben', 404)
  return item
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

export async function sharedPhoto(item: SharedItem, client: PublicClient = prisma) {
  if (item.kind === 'DOSSIER') {
    return (await client.dossier.findUnique({ where: { id: item.recordId }, select: { photo: { select: { filename: true, mimeType: true } } } }))?.photo ?? null
  }
  if (item.kind === 'PERSON') {
    const p = await client.person.findUnique({ where: { id: item.recordId }, select: { photoUrl: true } })
    const photoId = /^\/api\/investigations\/photos\/([^/]+)\/image$/.exec(p?.photoUrl ?? '')?.[1]
    return photoId ? client.investigationPhoto.findUnique({ where: { id: photoId }, select: { filename: true, mimeType: true } }) : null
  }
  return null
}

export async function publicRecord(item: SharedItem, client: PublicClient = prisma) {
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
  return { kind: item.kind, label: SHARE_KINDS[item.kind as ShareKind], recordId: id, title, fields, entries, hasPhoto: !!await sharedPhoto(item, client), hasVideo: item.kind === 'CLIP' }
}
