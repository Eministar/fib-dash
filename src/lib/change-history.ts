import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from './prisma'

type JsonObject = Record<string, unknown>

interface DynamicDelegate {
  findMany: (args?: unknown) => Promise<unknown[]>
  findUnique: (args: unknown) => Promise<unknown | null>
  create: (args: unknown) => Promise<unknown>
  update: (args: unknown) => Promise<unknown>
  delete: (args: unknown) => Promise<unknown>
}

interface DynamicClient {
  [key: string]: unknown
}

interface RecordState {
  exists: boolean
  value?: JsonObject
}

export interface HistoryActionSummary {
  id: string
  label: string
  createdAt: Date
  hasExternalSideEffects: boolean
}

export interface ChangeHistoryStatus {
  undo: HistoryActionSummary | null
  redo: HistoryActionSummary | null
}

export class ChangeHistoryConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChangeHistoryConflictError'
  }
}

const PRIMARY_KEYS: Record<string, string[]> = {
  UserGroupMembership: ['userId', 'groupId'],
  UserUnitAssignment: ['userId', 'unitId'],
  TierRank: ['tierId', 'rankId'],
}

// Kind-Modelle stehen nach ihren Eltern. Diese Reihenfolge reicht für Creates;
// Deletes verwenden sie umgekehrt. Nicht aufgeführte Modelle besitzen keine
// für die Historie relevante Pflicht-FK oder werden über ihre normale ID aktualisiert.
const MODEL_DEPENDENCIES: Record<string, string[]> = {
  Codename: ['Agent', 'User'],
  CodenameAssignment: ['Codename', 'Agent', 'User'],
  UserGroupMembership: ['User', 'UserGroup'],
  UserUnitAssignment: ['User', 'Unit'],
  Unit: ['UnitGroup'],
  TierRank: ['Tier', 'Rank'],
  FormQuestion: ['FormTest'],
  FormResponse: ['FormTest'],
  FormTestSession: ['FormTest', 'User'],
  FormAnswer: ['FormResponse', 'FormQuestion'],
  JobApplication: ['User'],
  JobApplicationAnswer: ['JobApplication'],
  Agent: ['Rank'],
  CalendarEvent: ['Agent', 'User'],
  SruFolder: ['User'],
  SruDocument: ['SruFolder', 'User'],
  Probation: ['Agent', 'User'],
  ProbationEntry: ['Probation', 'User'],
  AbsenceNotice: ['Agent'],
  DutyTimeSession: ['Agent'],
  PlaytimeSession: ['Agent'],
  AgentTraining: ['Agent', 'Training'],
  PromotionLog: ['Agent', 'Rank', 'User'],
  Termination: ['Agent', 'User'],
  Sanction: ['Agent', 'User'],
  Note: ['Agent', 'User'],
  RankChangeList: ['User'],
  RankChangeListEntry: ['RankChangeList', 'Agent', 'Rank', 'User'],
  RankChangeVote: ['RankChangeListEntry', 'User'],
  RankChangeEntryComment: ['RankChangeListEntry', 'User'],
  RankChangeEntryProposal: ['RankChangeListEntry', 'User'],
  RankChangeEntryHistory: ['RankChangeListEntry', 'User'],
  TaskList: ['User'],
  Task: ['TaskList', 'User'],
  TaskAssignment: ['Task', 'Agent'],
  ApiToken: ['User'],
  ApiTokenUsage: ['ApiToken'],
  Ordnung: ['OrdnungCategory', 'User'],
  ContractTemplate: ['User'],
  Contract: ['ContractTemplate', 'Agent', 'JobApplication', 'User'],
  TransferRequest: ['Agent', 'User'],
  ChangeSetSnapshot: ['ChangeSet'],
  ChangeSetEntry: ['ChangeSet'],
}

const modelMetadata = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]))

function delegateName(model: string): string {
  return model.slice(0, 1).toLowerCase() + model.slice(1)
}

function delegate(client: DynamicClient, model: string): DynamicDelegate {
  const value = client[delegateName(model)] as DynamicDelegate | undefined
  if (!value) throw new Error(`Prisma-Model nicht verfügbar: ${model}`)
  return value
}

function normalizeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, current) => (
    typeof current === 'bigint' ? { $bigint: current.toString() } : current
  )))
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stableValue(child)]),
    )
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function primaryKeyFields(model: string, row?: JsonObject): string[] {
  if (PRIMARY_KEYS[model]) return PRIMARY_KEYS[model]
  if (!row || Object.prototype.hasOwnProperty.call(row, 'id')) return ['id']
  throw new Error(`Kein Primärschlüssel für ${model} bekannt`)
}

function recordKey(model: string, row: JsonObject): JsonObject {
  return Object.fromEntries(primaryKeyFields(model, row).map((field) => [field, row[field]]))
}

function keyHash(key: JsonObject): string {
  return createHash('sha256').update(stableStringify(key)).digest('hex')
}

function uniqueWhere(model: string, key: JsonObject): JsonObject {
  const fields = primaryKeyFields(model, key)
  if (fields.length === 1) return { [fields[0]]: key[fields[0]] }
  return { [fields.join('_')]: key }
}

function state(row: JsonObject | undefined): RecordState {
  return row ? { exists: true, value: row } : { exists: false }
}

function readState(value: unknown): RecordState {
  const parsed = value as RecordState
  return parsed?.exists ? { exists: true, value: parsed.value as JsonObject } : { exists: false }
}

function deserializeRow(model: string, row: JsonObject): JsonObject {
  const metadata = modelMetadata.get(model)
  const result: JsonObject = {}
  for (const field of metadata?.fields ?? []) {
    if (field.kind === 'object' || !Object.prototype.hasOwnProperty.call(row, field.name)) continue
    const value = row[field.name]
    if (value === null && field.type === 'Json') {
      result[field.name] = Prisma.DbNull
    } else if (typeof value === 'string' && field.type === 'DateTime') {
      result[field.name] = new Date(value)
    } else if (field.type === 'BigInt' && value && typeof value === 'object' && '$bigint' in value) {
      result[field.name] = BigInt(String((value as JsonObject).$bigint))
    } else {
      result[field.name] = value
    }
  }
  return result
}

function updateData(model: string, row: JsonObject): JsonObject {
  const data = deserializeRow(model, row)
  for (const field of primaryKeyFields(model, row)) delete data[field]
  return data
}

function modelOrder(models: string[]): string[] {
  const available = new Set(models)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const result: string[] = []

  const visit = (model: string) => {
    if (visited.has(model)) return
    if (visiting.has(model)) return
    visiting.add(model)
    for (const dependency of MODEL_DEPENDENCIES[model] ?? []) {
      if (available.has(dependency)) visit(dependency)
    }
    visiting.delete(model)
    visited.add(model)
    result.push(model)
  }

  for (const model of models) visit(model)
  return result
}

async function currentRecord(client: DynamicClient, model: string, key: JsonObject): Promise<JsonObject | undefined> {
  const row = await delegate(client, model).findUnique({ where: uniqueWhere(model, key) })
  return row ? normalizeJson(row) as JsonObject : undefined
}

export async function commitChangeSet(changeSetId: string, userId: string): Promise<{ recorded: boolean }> {
  const changeSet = await prisma.changeSet.findFirst({
    where: { id: changeSetId, userId, status: 'PENDING' },
    include: { snapshots: true, targets: true },
  })
  if (!changeSet) return { recorded: false }

  const entries: Array<{
    changeSetId: string
    model: string
    keyHash: string
    recordKey: Prisma.InputJsonValue
    before: Prisma.InputJsonValue
    after: Prisma.InputJsonValue
    sortOrder: number
  }> = []
  let sortOrder = 0
  const targetedHashes = new Map<string, Set<string>>()

  for (const target of changeSet.targets) {
    const key = target.recordKey as unknown as JsonObject
    const before = readState(target.before)
    const afterRow = await currentRecord(prisma as unknown as DynamicClient, target.model, key)
    const after = state(afterRow)
    if (sameValue(before, after)) continue
    if (!targetedHashes.has(target.model)) targetedHashes.set(target.model, new Set())
    targetedHashes.get(target.model)!.add(target.keyHash)
    entries.push({
      changeSetId,
      model: target.model,
      keyHash: target.keyHash,
      recordKey: key as Prisma.InputJsonValue,
      before: before as unknown as Prisma.InputJsonValue,
      after: after as unknown as Prisma.InputJsonValue,
      sortOrder: sortOrder++,
    })
  }

  for (const snapshot of changeSet.snapshots) {
    const beforeRows = (snapshot.before as unknown as JsonObject[]) ?? []
    const afterRows = normalizeJson(await delegate(prisma as unknown as DynamicClient, snapshot.model).findMany()) as JsonObject[]
    const beforeMap = new Map(beforeRows.map((row) => {
      const key = recordKey(snapshot.model, row)
      return [keyHash(key), { key, row }] as const
    }))
    const afterMap = new Map(afterRows.map((row) => {
      const key = recordKey(snapshot.model, row)
      return [keyHash(key), { key, row }] as const
    }))

    for (const hash of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
      if (targetedHashes.get(snapshot.model)?.has(hash)) continue
      const before = beforeMap.get(hash)
      const after = afterMap.get(hash)
      if (sameValue(before?.row, after?.row)) continue
      entries.push({
        changeSetId,
        model: snapshot.model,
        keyHash: hash,
        recordKey: (before?.key ?? after!.key) as Prisma.InputJsonValue,
        before: state(before?.row) as unknown as Prisma.InputJsonValue,
        after: state(after?.row) as unknown as Prisma.InputJsonValue,
        sortOrder: sortOrder++,
      })
    }
  }

  if (entries.length === 0) {
    await prisma.changeSet.delete({ where: { id: changeSetId } })
    return { recorded: false }
  }

  await prisma.$transaction(async (tx) => {
    await tx.changeSet.deleteMany({ where: { userId, status: 'UNDONE' } })
    await tx.changeSetEntry.createMany({ data: entries })
    await tx.changeSetSnapshot.deleteMany({ where: { changeSetId } })
    await tx.changeSetTarget.deleteMany({ where: { changeSetId } })
    await tx.changeSet.update({
      where: { id: changeSetId },
      data: { status: 'APPLIED', committedAt: new Date() },
    })
  })

  const stale = await prisma.changeSet.findMany({
    where: { userId, status: { in: ['APPLIED', 'UNDONE'] } },
    orderBy: { createdAt: 'desc' },
    skip: 50,
    select: { id: true },
  })
  if (stale.length > 0) {
    await prisma.changeSet.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } })
  }

  return { recorded: true }
}

export async function discardChangeSet(changeSetId: string, userId: string): Promise<void> {
  await prisma.changeSet.deleteMany({ where: { id: changeSetId, userId, status: 'PENDING' } })
}

export async function getChangeHistoryStatus(userId: string): Promise<ChangeHistoryStatus> {
  await prisma.changeSet.deleteMany({
    where: { userId, status: 'PENDING', createdAt: { lt: new Date(Date.now() - 60 * 60 * 1_000) } },
  })

  const [undo, redo] = await Promise.all([
    prisma.changeSet.findFirst({
      where: { userId, status: 'APPLIED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, createdAt: true, hasExternalSideEffects: true },
    }),
    prisma.changeSet.findFirst({
      where: { userId, status: 'UNDONE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true, createdAt: true, hasExternalSideEffects: true },
    }),
  ])
  return { undo, redo }
}

export async function applyChangeHistory(
  userId: string,
  direction: 'undo' | 'redo',
): Promise<{ action: HistoryActionSummary; affectedModels: string[] }> {
  const expectedStatus = direction === 'undo' ? 'APPLIED' : 'UNDONE'
  const targetStatus = direction === 'undo' ? 'UNDONE' : 'APPLIED'
  const orderBy = direction === 'undo' ? { createdAt: 'desc' as const } : { createdAt: 'asc' as const }
  const changeSet = await prisma.changeSet.findFirst({
    where: { userId, status: expectedStatus },
    orderBy,
    include: { entries: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!changeSet) throw new ChangeHistoryConflictError(direction === 'undo' ? 'Nichts zum Rückgängigmachen' : 'Nichts zum Wiederholen')

  const affectedModels = [...new Set(changeSet.entries.map((entry) => entry.model))]
  await prisma.$transaction(async (tx) => {
    const client = tx as unknown as DynamicClient
    const operations = [] as Array<{
      model: string
      key: JsonObject
      current: JsonObject | undefined
      target: RecordState
    }>

    for (const entry of changeSet.entries) {
      const before = readState(entry.before)
      const after = readState(entry.after)
      const expected = direction === 'undo' ? after : before
      const target = direction === 'undo' ? before : after
      const key = entry.recordKey as unknown as JsonObject
      const current = await currentRecord(client, entry.model, key)
      const currentState = state(current)
      if (!sameValue(currentState, expected)) {
        throw new ChangeHistoryConflictError(
          `„${changeSet.label}“ kann nicht ${direction === 'undo' ? 'rückgängig gemacht' : 'wiederholt'} werden, weil ${entry.model} inzwischen geändert wurde.`,
        )
      }
      operations.push({ model: entry.model, key, current, target })
    }

    const orderedModels = modelOrder(affectedModels)
    const modelRank = new Map(orderedModels.map((model, index) => [model, index]))
    const deletes = operations
      .filter((operation) => operation.current && !operation.target.exists)
      .sort((a, b) => (modelRank.get(b.model) ?? 0) - (modelRank.get(a.model) ?? 0))
    const creates = operations
      .filter((operation) => !operation.current && operation.target.exists)
      .sort((a, b) => (modelRank.get(a.model) ?? 0) - (modelRank.get(b.model) ?? 0))
    const updates = operations
      .filter((operation) => operation.current && operation.target.exists)
      .sort((a, b) => (modelRank.get(a.model) ?? 0) - (modelRank.get(b.model) ?? 0))

    for (const operation of deletes) {
      await delegate(client, operation.model).delete({ where: uniqueWhere(operation.model, operation.key) })
    }
    for (const operation of creates) {
      await delegate(client, operation.model).create({ data: deserializeRow(operation.model, operation.target.value!) })
    }
    for (const operation of updates) {
      await delegate(client, operation.model).update({
        where: uniqueWhere(operation.model, operation.key),
        data: updateData(operation.model, operation.target.value!),
      })
    }

    await tx.changeSet.update({
      where: { id: changeSet.id },
      data: {
        status: targetStatus,
        undoneAt: direction === 'undo' ? new Date() : null,
      },
    })
    await tx.auditLog.create({
      data: {
        action: direction === 'undo' ? 'CHANGE_UNDONE' : 'CHANGE_REDONE',
        userId,
        details: changeSet.label,
      },
    })
  })

  return {
    action: {
      id: changeSet.id,
      label: changeSet.label,
      createdAt: changeSet.createdAt,
      hasExternalSideEffects: changeSet.hasExternalSideEffects,
    },
    affectedModels,
  }
}
