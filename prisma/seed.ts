// @ts-nocheck
import 'dotenv/config'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import bcrypt from 'bcryptjs'
import { PERMISSIONS } from '../src/lib/permissions'

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

type UpsertDelegate = {
  upsert: (args: unknown) => Promise<unknown>
}

function getUpsertDelegate(names: readonly string[]): UpsertDelegate {
  const client = prisma as unknown as Record<string, UpsertDelegate | undefined>
  const delegate = names.map((name) => client[name]).find(Boolean)
  if (!delegate) {
    throw new Error(`Prisma-Delegate nicht gefunden: ${names.join(' / ')}`)
  }
  return delegate
}

const SEED_ORDNUNG_CATEGORIES = [
  { key: 'allgemein', label: 'Allgemein', description: 'Allgemeine Dienstordnungen und verbindliche Richtlinien', icon: 'Scale', color: '#4a8fd8', sortOrder: 0 },
  { key: 'hr', label: 'Human Resources', description: 'Richtlinien und Verfahren für die HR-Abteilung', icon: 'Briefcase', color: '#d4af37', sortOrder: 1 },
]
// Mapping der alten config.json-Kategorien auf die neuen Kategorie-Keys.
const LEGACY_CATEGORY_KEY = { Allgemein: 'allgemein', HR: 'hr' }

async function importOrdnungen() {
  const existing = await prisma.ordnung.count()
  if (existing > 0) {
    console.log('Ordnungen bereits vorhanden — Import übersprungen.')
    return
  }

  // Kategorien anlegen (idempotent per key).
  const catIdByKey = {}
  for (const c of SEED_ORDNUNG_CATEGORIES) {
    const cat = await prisma.ordnungCategory.upsert({
      where: { key: c.key },
      update: {},
      create: c,
    })
    catIdByKey[c.key] = cat.id
  }

  const dir = path.join(process.cwd(), 'ordnungen')
  let configRaw: string
  try {
    configRaw = await fs.readFile(path.join(dir, 'config.json'), 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log('Kein ordnungen/config.json gefunden — Import übersprungen.')
      return
    }
    throw e
  }
  const parsed = JSON.parse(configRaw)
  const entries = Array.isArray(parsed?.ordnungen) ? parsed.ordnungen : []

  let sort = 0
  for (const e of entries) {
    const categoryKey = LEGACY_CATEGORY_KEY[e.category] ?? 'allgemein'
    const content = await fs.readFile(path.join(dir, e.file), 'utf8')
    await prisma.ordnung.create({
      data: {
        slug: e.id,
        title: e.title,
        description: e.description ?? '',
        buttonLabel: e.buttonLabel ?? e.title,
        icon: typeof e.icon === 'string' ? e.icon : 'FileText',
        content,
        categoryId: catIdByKey[categoryKey],
        sortOrder: sort++,
      },
    })
    console.log(`  importiert: ${e.id}`)
  }
  console.log(`Ordnungen-Import fertig (${entries.length}).`)
}

async function main() {
  console.log('Seeding database...')

  const groups = [
    { name: 'Administration', description: 'Voller Zugriff auf alle Bereiche.', permissions: [...PERMISSIONS] },
    {
      name: 'HR',
      description: 'Personalverwaltung, Aufgaben, Kündigungen und Rangänderungen.',
      permissions: [
        'agents:write',
        'agent-trainings:manage',
        'agents:view',
        'calendar:manage',
        'calendar:view',
        'duty-times:manage',
        'duty-times:view',
        'terminations:manage',
        'terminations:view',
        'probations:manage',
        'probations:view',
        'rank-changes:manage',
        'rank-changes:view',
        'academy:manage',
        'academy-tests:manage',
        'academy:view',
        'hr:manage',
        'hr-tests:manage',
        'hr:view',
        'sru:manage',
        'sru:view',
        'air-support:manage',
        'air-support:view',
        'notes:manage',
        'notes:view',
        'logs:view',
        'exports:view',
        'ranks:view',
        'trainings:view',
        'units:view',
        'password:change',
      ],
    },
    {
      name: 'Führungsebene',
      description: 'Aufgaben, Notizen und Protokolle.',
      permissions: ['dashboard:view', 'calendar:view', 'agents:view', 'duty-times:view', 'probations:view', 'academy:manage', 'academy-tests:manage', 'academy:view', 'hr:manage', 'hr-tests:manage', 'hr:view', 'sru:manage', 'sru:view', 'air-support:manage', 'air-support:view', 'notes:manage', 'notes:view', 'logs:view', 'exports:view', 'password:change'],
    },
  ]

  let adminGroup: { id: string } | null = null
  for (const group of groups) {
    const savedGroup = await getUpsertDelegate(['userGroup', 'usergroup']).upsert({
      where: { name: group.name },
      update: { description: group.description, permissions: group.permissions },
      create: group,
    }) as { id: string }
    if (group.name === 'Administration') adminGroup = savedGroup
  }
  console.log('User groups created:', groups.length)

  if (!adminGroup) throw new Error('Administrationsgruppe konnte nicht erstellt werden')

  const passwordHash = await bcrypt.hash('admin123', 12)
  const admin = await getUpsertDelegate(['user']).upsert({
    where: { username: 'admin' },
    update: { groupId: adminGroup.id },
    create: {
      username: 'admin',
      passwordHash,
      displayName: 'Administrator',
      groupId: adminGroup.id,
    },
  }) as { id: string; username: string }
  await getUpsertDelegate(['userGroupMembership', 'usergroupmembership']).upsert({
    where: { userId_groupId: { userId: admin.id, groupId: adminGroup.id } },
    update: {},
    create: { userId: admin.id, groupId: adminGroup.id },
  })
  console.log('Admin user created:', admin.username)

  const units = [
    { key: 'HR_LEITUNG', name: 'HR Leitung', sortOrder: 1, color: '#7c3aed' },
    { key: 'HR_TRAINEE', name: 'HR Trainee', sortOrder: 2, color: '#3b82f6' },
    { key: 'HR_OFFICER', name: 'HR Officer', sortOrder: 3, color: '#06b6d4' },
    { key: 'ACADEMY', name: 'Academy', sortOrder: 4, color: '#d4af37' },
    { key: 'SRU', name: 'S.W.U.', sortOrder: 5, color: '#dc2626' },
    { key: 'AIR_SUPPORT', name: 'Air-Support Division', sortOrder: 6, color: '#38bdf8' },
{ key: 'INTERNAL_AFFAIRS', name: 'Internal Affairs', sortOrder: 7, color: '#0ea5e9' },
    { key: 'LAD', name: 'Legal Affairs Division', sortOrder: 8, color: '#8b5cf6' },
  ]

  for (const unit of units) {
    await getUpsertDelegate(['unit']).upsert({
      where: { key: unit.key },
      update: { name: unit.name, sortOrder: unit.sortOrder, color: unit.color, active: true },
      create: unit,
    })
  }
  console.log('Units created:', units.length)

  const ranks = [
    { name: 'Chief of Police', sortOrder: 1, color: '#DC2626' },
    { name: 'Assistant Chief of Police', sortOrder: 2, color: '#EA580C' },
    { name: 'Deputy Chief of Police', sortOrder: 3, color: '#D97706' },
    { name: 'Commander of Organisation', sortOrder: 4, color: '#CA8A04' },
    { name: 'Commander of Operation', sortOrder: 5, color: '#65A30D' },
    { name: 'Captain of FIB', sortOrder: 6, color: '#16A34A' },
    { name: 'Lieutenant 2', sortOrder: 7, color: '#0D9488' },
    { name: 'Lieutenant 1', sortOrder: 8, color: '#0891B2' },
    { name: 'Sergeant 2', sortOrder: 9, color: '#2563EB' },
    { name: 'Sergeant 1', sortOrder: 10, color: '#4F46E5' },
    { name: 'Senior Officer', sortOrder: 11, color: '#7C3AED' },
    { name: 'Officer 3', sortOrder: 12, color: '#9333EA' },
    { name: 'Officer 2', sortOrder: 13, color: '#A855F7' },
    { name: 'Officer 1', sortOrder: 14, color: '#C084FC' },
    { name: 'Rookie', sortOrder: 15, color: '#6B7280' },
  ]

  for (const rank of ranks) {
    await getUpsertDelegate(['rank']).upsert({
      where: { name: rank.name },
      update: { sortOrder: rank.sortOrder, color: rank.color },
      create: rank,
    })
  }
  console.log('Ranks created:', ranks.length)

  const trainings = [
    { key: 'erste_hilfe', label: 'Erste Hilfe', sortOrder: 1 },
    { key: 'grundausbildung', label: 'Grundausbildung', sortOrder: 2 },
    { key: 'tablet', label: 'Tablet', sortOrder: 3 },
    { key: 'langwaffe', label: 'Langwaffe', sortOrder: 4 },
    { key: 'einsatzleitung', label: 'Einsatzleitung', sortOrder: 5 },
    { key: 'verhandlung', label: 'Verhandlungsführung', sortOrder: 6 },
  ]

  for (const training of trainings) {
    await getUpsertDelegate(['training']).upsert({
      where: { key: training.key },
      update: { label: training.label, sortOrder: training.sortOrder },
      create: training,
    })
  }
  console.log('Trainings created:', trainings.length)

  await importOrdnungen()

  console.log('Seeding completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
