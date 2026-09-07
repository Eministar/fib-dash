import { Prisma } from '@/generated/prisma/client'
import { createHash } from 'node:crypto'
import { currentChangeTracking } from './change-history-context'

type JsonObject = Record<string, unknown>

interface SnapshotDelegate {
  findMany: (args?: unknown) => Promise<unknown[]>
  findUnique: (args: unknown) => Promise<unknown | null>
}

interface SnapshotStoreDelegate {
  upsert: (args: unknown) => Promise<unknown>
}

export interface SnapshotClient {
  changeSetSnapshot: SnapshotStoreDelegate
  changeSetTarget: SnapshotStoreDelegate
  [key: string]: unknown
}

export interface MutationCapture {
  changeSetId: string
  model: string
  operation: string
}

const MUTATION_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
])

const EXCLUDED_MODELS = new Set([
  'AuditLog',
  'ChangeSet',
  'ChangeSetSnapshot',
  'ChangeSetTarget',
  'ChangeSetEntry',
])

const PRIMARY_KEYS: Record<string, string[]> = {
  UserGroupMembership: ['userId', 'groupId'],
  UserUnitAssignment: ['userId', 'unitId'],
  TierRank: ['tierId', 'rankId'],
}

const DELETE_AFFECTED_MODELS: Record<string, string[]> = {
  User: [
    'UserGroupMembership', 'UserUnitAssignment', 'FormTestSession', 'JobApplication', 'RankChangeVote', 'ApiToken',
    'RankChangeEntryComment', 'RankChangeEntryProposal', 'RankChangeEntryHistory',
    'AcademyResource', 'FormTest', 'FormResponse', 'PressRelease', 'CalendarEvent', 'SruFolder', 'SruDocument',
    'Probation', 'ProbationEntry', 'PromotionLog', 'Termination', 'Sanction', 'Note', 'RankChangeList',
    'RankChangeListEntry', 'TaskList', 'Task', 'Ordnung', 'ContractTemplate', 'Contract',
    'TransferRequest',
  ],
  UserGroup: ['UserGroupMembership', 'User'],
  UnitGroup: ['Unit'],
  Unit: ['UserUnitAssignment', 'UnitGroup'],
  Tier: ['TierRank'],
  Rank: ['TierRank', 'Training'],
  Training: ['AgentTraining', 'AcademyResource'],
  FormTest: ['FormQuestion', 'FormResponse', 'FormTestSession'],
  FormQuestion: ['FormAnswer'],
  FormResponse: ['FormAnswer'],
  Agent: [
    'Probation', 'AbsenceNotice', 'DutyTimeSession', 'PlaytimeSession', 'AgentTraining', 'PromotionLog',
    'Termination', 'Sanction', 'Note', 'RankChangeListEntry', 'TaskAssignment',
    'CalendarEvent', 'JobApplication', 'Contract', 'TransferRequest',
  ],
  Probation: ['ProbationEntry'],
  RankChangeList: ['RankChangeListEntry'],
  RankChangeListEntry: ['RankChangeVote', 'RankChangeEntryComment', 'RankChangeEntryProposal', 'RankChangeEntryHistory'],
  TaskList: ['Task'],
  Task: ['TaskAssignment'],
  ApiToken: ['ApiTokenUsage'],
  SruFolder: ['SruDocument'],
  Sanction: ['Sanction'],
  ContractTemplate: ['Contract'],
  JobApplication: ['JobApplicationAnswer', 'Contract'],
}

const relationFields = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    model.fields
      .filter((field) => field.kind === 'object')
      .map((field) => ({ name: field.name, type: field.type })),
  ]),
)

function delegateName(model: string): string {
  return model.slice(0, 1).toLowerCase() + model.slice(1)
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null
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

function primaryKeyFields(model: string): string[] {
  return PRIMARY_KEYS[model] ?? ['id']
}

function recordKey(model: string, row: JsonObject): JsonObject | null {
  const fields = primaryKeyFields(model)
  if (fields.some((field) => row[field] === undefined)) return null
  return Object.fromEntries(fields.map((field) => [field, row[field]]))
}

function hashKey(key: JsonObject): string {
  return createHash('sha256').update(JSON.stringify(stableValue(key))).digest('hex')
}

function recordState(row?: JsonObject): JsonObject {
  return row ? { exists: true, value: jsonValue(row) } : { exists: false }
}

function collectNestedModels(model: string, value: unknown, target: Set<string>, depth = 0): void {
  if (depth > 12 || value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectNestedModels(model, item, target, depth + 1)
    return
  }
  if (typeof value !== 'object') return

  const object = value as JsonObject
  const relations = relationFields.get(model) ?? []
  for (const relation of relations) {
    if (!Object.prototype.hasOwnProperty.call(object, relation.name)) continue
    target.add(relation.type)
    collectNestedModels(relation.type, object[relation.name], target, depth + 1)
  }

  // Prisma verschachtelt Daten unter Schlüsseln wie create/update/upsert/data.
  // Innerhalb dieser Hüllen gilt weiterhin dasselbe Model, bis ein Relationsfeld auftaucht.
  for (const child of Object.values(object)) {
    collectNestedModels(model, child, target, depth + 1)
  }
}

function collectCascadeModels(model: string, target: Set<string>): void {
  for (const dependent of DELETE_AFFECTED_MODELS[model] ?? []) {
    if (EXCLUDED_MODELS.has(dependent) || target.has(dependent)) continue
    target.add(dependent)
    collectCascadeModels(dependent, target)
  }
}

async function snapshotModel(client: SnapshotClient, changeSetId: string, model: string): Promise<void> {
  if (EXCLUDED_MODELS.has(model)) return
  const delegate = client[delegateName(model)] as SnapshotDelegate | undefined
  if (!delegate?.findMany) return

  const rows = await delegate.findMany()
  await client.changeSetSnapshot.upsert({
    where: { changeSetId_model: { changeSetId, model } },
    create: { changeSetId, model, before: jsonValue(rows) },
    // Der erste Stand ist maßgeblich. Parallele Mutationen desselben Requests
    // dürfen den Vorher-Zustand nicht überschreiben.
    update: {},
  })
}

async function stageTarget(
  client: SnapshotClient,
  changeSetId: string,
  model: string,
  row: JsonObject,
  existedBefore: boolean,
): Promise<void> {
  const key = recordKey(model, row)
  if (!key) return
  await client.changeSetTarget.upsert({
    where: { changeSetId_model_keyHash: { changeSetId, model, keyHash: hashKey(key) } },
    create: {
      changeSetId,
      model,
      keyHash: hashKey(key),
      recordKey: jsonValue(key),
      before: recordState(existedBefore ? row : undefined),
    },
    // Falls derselbe Datensatz im Request mehrfach geändert wird, bleibt der
    // allererste Vorher-Stand erhalten.
    update: {},
  })
}

async function rowsBeforeMutation(
  client: SnapshotClient,
  model: string,
  operation: string,
  args: { where?: unknown } | undefined,
): Promise<JsonObject[]> {
  const modelDelegate = client[delegateName(model)] as SnapshotDelegate | undefined
  if (!modelDelegate) return []
  if (['update', 'delete', 'upsert'].includes(operation)) {
    const row = await modelDelegate.findUnique({ where: args?.where })
    return row ? [row as JsonObject] : []
  }
  if (operation === 'updateMany' || operation === 'updateManyAndReturn' || operation === 'deleteMany') {
    return await modelDelegate.findMany({ where: args?.where }) as JsonObject[]
  }
  return []
}

export async function prepareMutationCapture(params: {
  client: SnapshotClient
  model: string
  operation: string
  args: unknown
}): Promise<MutationCapture | null> {
  const context = currentChangeTracking()
  if (!context || !MUTATION_OPERATIONS.has(params.operation) || EXCLUDED_MODELS.has(params.model)) return null

  const args = params.args as { data?: unknown; where?: unknown } | undefined
  const beforeRows = await rowsBeforeMutation(params.client, params.model, params.operation, args)
  await Promise.all(beforeRows.map((row) => stageTarget(params.client, context.changeSetId, params.model, row, true)))

  // Explizit gesetzte IDs können schon vor dem Create erfasst werden. Bei
  // automatisch erzeugten IDs ergänzt completeMutationCapture das Ziel danach.
  const createData = args?.data
  if ((params.operation === 'create' || params.operation === 'createMany' || params.operation === 'createManyAndReturn') && createData) {
    const rows = Array.isArray(createData) ? createData : [createData]
    await Promise.all(rows.map((row) => (
      row && typeof row === 'object'
        ? stageTarget(params.client, context.changeSetId, params.model, row as JsonObject, false)
        : Promise.resolve()
    )))
  }

  const models = new Set<string>()
  collectNestedModels(params.model, args?.data, models)
  if (params.operation === 'delete' || params.operation === 'deleteMany') {
    collectCascadeModels(params.model, models)
  }
  // Bei selbstreferenziellen Relationen (z. B. Sanktionen) können beim
  // Löschen weitere Zeilen desselben Models per SetNull verändert werden.
  // Dafür brauchen wir ausnahmsweise zusätzlich den vollständigen Snapshot.
  const hasSelfReferentialDeleteEffect = (DELETE_AFFECTED_MODELS[params.model] ?? []).includes(params.model)
  if (!hasSelfReferentialDeleteEffect) models.delete(params.model)

  await Promise.all([...models].map((model) => snapshotModel(params.client, context.changeSetId, model)))
  return { changeSetId: context.changeSetId, model: params.model, operation: params.operation }
}

export async function completeMutationCapture(
  client: SnapshotClient,
  capture: MutationCapture | null,
  result: unknown,
): Promise<void> {
  if (!capture || result === null || result === undefined) return
  const candidates = Array.isArray(result) ? result : [result]
  await Promise.all(candidates.map((candidate) => (
    candidate && typeof candidate === 'object'
      ? stageTarget(client, capture.changeSetId, capture.model, candidate as JsonObject, false)
      : Promise.resolve()
  )))
}

export function describeTrackedChange(method: string, path: string): string {
  const normalized = path.split('?')[0]
  const mappings: Array<[RegExp, string]> = [
    [/\/rank-change-entries\/.+\/comments/, 'Kommentar zur Rangänderung geändert'],
    [/\/rank-change-entries\/.+\/proposals/, 'Vorschlag zur Rangänderung geändert'],
    [/\/rank-change-entries/, 'Rangänderung bearbeitet'],
    [/\/rank-change-lists\/.+\/vote$/, 'Abstimmung geändert'],
    [/\/rank-change-lists/, 'Up-/D-Rank-Liste geändert'],
    [/\/agents/, 'Agent-Daten geändert'],
    [/\/ranks/, 'Ränge geändert'],
    [/\/trainings/, 'Ausbildungen geändert'],
    [/\/sanctions/, 'Sanktion geändert'],
    [/\/calendar-events/, 'Kalender geändert'],
    [/\/tasks|\/task-lists/, 'Aufgabe geändert'],
    [/\/probations/, 'Probezeit geändert'],
    [/\/reports/, 'Bericht geändert'],
    [/\/contracts|\/contract-templates/, 'Vertrag geändert'],
    [/\/transfer-requests/, 'Versetzung geändert'],
    [/\/applications/, 'Bewerbung geändert'],
    [/\/form-tests/, 'Formular/Test geändert'],
    [/\/ordnungen/, 'Ordnung geändert'],
    [/\/unit-groups|\/units/, 'Unit geändert'],
    [/\/users|\/user-groups/, 'Benutzerverwaltung geändert'],
    [/\/settings|\/discord\/config/, 'Einstellungen geändert'],
  ]
  const match = mappings.find(([pattern]) => pattern.test(normalized))
  if (match) return match[1]
  return method === 'DELETE' ? 'Eintrag gelöscht' : method === 'POST' ? 'Eintrag erstellt' : 'Änderung gespeichert'
}

export function pathHasExternalSideEffects(path: string): boolean {
  return [
    /\/discord(?:\/|$)/,
    /\/discord-message(?:\/|$)/,
    /\/sync(?:-|\/|$)/,
    /\/send(?:\/|$)/,
    /\/sign(?:\/|$)/,
    /\/execute(?:\/|$)/,
    /\/promotions(?:\/|$)/,
    /\/terminations(?:\/|$)/,
    /\/agents(?:\/|$)/,
    /\/unit-groups(?:\/|$)/,
    /\/users(?:\/|$)/,
    /\/absences(?:\/|$)/,
    /\/calendar-events(?:\/|$)/,
    /\/uploads(?:\/|$)/,
    /\/status-automation(?:\/|$)/,
    /\/runtime-events(?:\/|$)/,
  ].some((pattern) => pattern.test(path))
}
