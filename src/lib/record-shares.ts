import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './prisma'
import type { CurrentUser } from './auth'
import type { Prisma } from '@/generated/prisma'
import { investigationVisibilityWhere } from './investigations'
import { hasPermission } from './permissions'
import { error, forbidden, unauthorized } from './api-response'
import { shareIsActive, type ShareKind, type ShareSelection } from './record-share-validation'

export class ShareError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
export function shareError(cause: unknown) {
  if (cause instanceof Error && cause.message === 'Unauthorized') return unauthorized()
  if (cause instanceof Error && cause.message === 'Forbidden') return forbidden()
  if (cause instanceof ShareError) return error(cause.message, cause.status)
  if (cause instanceof z.ZodError) return error(cause.issues.map(i => i.message).join('; '))
  if (cause instanceof SyntaxError) return error('Ungültige Eingabe')
  console.error('[RecordShare]', cause)
  return error('Freigabe konnte nicht verarbeitet werden', 500)
}
export function tokenHash(token: string) { return createHash('sha256').update(token).digest('hex') }
export function createShareToken() { const token = randomBytes(32).toString('base64url'); return { token, tokenHash: tokenHash(token) } }
export const sharePath = (token: string) => `/share/records/${token}`
export function managedSharesWhere(user: CurrentUser) { return hasPermission(user, 'settings:manage') ? {} : { createdById: user.id } }

export async function resolveShare(token: string, lookup = (hash: string) => prisma.recordShare.findUnique({ where: { tokenHash: hash }, include: { items: true } })) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ShareError('Link ungültig, abgelaufen oder deaktiviert', 404)
  const share = await lookup(tokenHash(token))
  if (!share || !shareIsActive(share)) throw new ShareError('Link ungültig, abgelaufen oder deaktiviert', 404)
  return share
}

export type ShareCandidate = ShareSelection & { title: string; classifiedAtGrant: boolean }
type Client = Pick<Prisma.TransactionClient, 'dossier' | 'investigation' | 'person' | 'vehicle' | 'bodycamClip'>
export async function shareCandidates(client: Client, user: CurrentUser, kind: ShareKind, search = '', page = 1) {
  const take = 30, skip = (page - 1) * take
  if (kind === 'DOSSIER') {
    const where = search ? { title: { contains: search } } : {}
    const [rows, total] = await Promise.all([client.dossier.findMany({ where, select: { id: true, title: true, kind: true }, orderBy: { title: 'asc' }, take, skip }), client.dossier.count({ where })])
    return { items: rows.map(r => ({ kind, recordId: r.id, title: r.title, classifiedAtGrant: false })), total }
  }
  if (kind === 'PERSON') {
    const where = search ? { OR: [{ firstName: { contains: search } }, { lastName: { contains: search } }, { personNumber: { contains: search } }] } : {}
    const [rows, total] = await Promise.all([client.person.findMany({ where, select: { id: true, personNumber: true, firstName: true, lastName: true }, orderBy: { lastName: 'asc' }, take, skip }), client.person.count({ where })])
    return { items: rows.map(r => ({ kind, recordId: r.id, title: `${r.personNumber} · ${r.firstName} ${r.lastName}`, classifiedAtGrant: false })), total }
  }
  if (kind === 'VEHICLE') {
    const where = search ? { OR: [{ vehicleNumber: { contains: search } }, { plate: { contains: search } }, { model: { contains: search } }] } : {}
    const [rows, total] = await Promise.all([client.vehicle.findMany({ where, select: { id: true, vehicleNumber: true, plate: true, model: true }, orderBy: { vehicleNumber: 'asc' }, take, skip }), client.vehicle.count({ where })])
    return { items: rows.map(r => ({ kind, recordId: r.id, title: `${r.vehicleNumber} · ${r.plate ?? r.model ?? 'Fahrzeug'}`, classifiedAtGrant: false })), total }
  }
  if (kind === 'CASE') {
    const where = { AND: [investigationVisibilityWhere(user), ...(search ? [{ OR: [{ title: { contains: search } }, { caseNumber: { contains: search } }] }] : [])] }
    const [rows, total] = await Promise.all([client.investigation.findMany({ where, select: { id: true, title: true, caseNumber: true, classified: true }, orderBy: { updatedAt: 'desc' }, take, skip }), client.investigation.count({ where })])
    return { items: rows.map(r => ({ kind, recordId: r.id, title: `${r.caseNumber} · ${r.title}`, classifiedAtGrant: r.classified })), total }
  }
  const where = { investigation: investigationVisibilityWhere(user), ...(search ? { title: { contains: search } } : {}) }
  const [rows, total] = await Promise.all([client.bodycamClip.findMany({ where, select: { id: true, title: true, investigation: { select: { classified: true } } }, orderBy: { createdAt: 'desc' }, take, skip }), client.bodycamClip.count({ where })])
  return { items: rows.map(r => ({ kind, recordId: r.id, title: r.title, classifiedAtGrant: r.investigation.classified })), total }
}

export async function validateShareItems(client: Client, user: CurrentUser, items: ShareSelection[]): Promise<ShareCandidate[]> {
  return Promise.all(items.map(async item => {
    const { kind, recordId: id } = item
    if (kind === 'CASE') {
      const row = await client.investigation.findFirst({ where: { AND: [{ id }, investigationVisibilityWhere(user)] }, select: { title: true, caseNumber: true, classified: true } })
      if (row) return { ...item, title: `${row.caseNumber} · ${row.title}`, classifiedAtGrant: row.classified }
    } else if (kind === 'CLIP') {
      const row = await client.bodycamClip.findFirst({ where: { id, investigation: investigationVisibilityWhere(user) }, select: { title: true, investigation: { select: { classified: true } } } })
      if (row) return { ...item, title: row.title, classifiedAtGrant: row.investigation.classified }
    } else if (kind === 'DOSSIER') {
      const row = await client.dossier.findUnique({ where: { id }, select: { title: true } })
      if (row) return { ...item, title: row.title, classifiedAtGrant: false }
    } else if (kind === 'PERSON') {
      const row = await client.person.findUnique({ where: { id }, select: { firstName: true, lastName: true, personNumber: true } })
      if (row) return { ...item, title: `${row.personNumber} · ${row.firstName} ${row.lastName}`, classifiedAtGrant: false }
    } else {
      const row = await client.vehicle.findUnique({ where: { id }, select: { vehicleNumber: true, plate: true } })
      if (row) return { ...item, title: `${row.vehicleNumber} · ${row.plate ?? 'Fahrzeug'}`, classifiedAtGrant: false }
    }
    throw new ShareError('Ein ausgewählter Eintrag existiert nicht oder ist nicht mehr zugänglich', 403)
  }))
}

export function publicShareHeaders(response: Response) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}
