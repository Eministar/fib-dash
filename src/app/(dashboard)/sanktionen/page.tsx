'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Gavel, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { SanctionCard, type SanctionCardAgent, type SanctionRecord } from '@/components/sanctions/sanction-card'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { displayBadgeNumber } from '@/lib/badge-number'
import { hasPermission } from '@/lib/permissions'
import {
  DECISION_CHECKLIST,
  PENAL_GRADE_ORDER,
  PENAL_GRADE_RULES,
  SANCTION_LEVELS,
  SANCTION_LEVEL_ORDER,
  isPenalGrade,
  isSanctionLevel,
  penalGradeLabel,
  resolveViolation,
  sanctionLevelLabel,
  violationsForGrade,
} from '@/lib/sanction-catalog'
import { cn } from '@/lib/utils'

/** Serverantwort von `GET /api/sanctions` — Karte plus Agent-Bezug. */
interface SanctionListItem extends SanctionRecord {
  agentId: string | null
  agent: {
    id: string
    firstName: string
    lastName: string
    badgeNumber: string
    status: string
    rank: { name: string; color: string } | null
  } | null
  issuedByUserId: string | null
  previousRank: string | null
  previousBadgeNumber: string | null
  previousFirstName: string | null
  previousLastName: string | null
}

interface EditForm {
  penalGrade: string
  level: string
  violationCode: string
  reason: string
  penalty: string
}

const PENAL_GRADE_OPTIONS = [
  { value: '', label: 'Alle Penal Grades' },
  ...PENAL_GRADE_ORDER.map((grade) => ({ value: grade, label: penalGradeLabel(grade) })),
]

const EDIT_PENAL_GRADE_OPTIONS = PENAL_GRADE_ORDER.map((grade) => ({
  value: grade,
  label: penalGradeLabel(grade),
}))

const LEVEL_OPTIONS = SANCTION_LEVEL_ORDER.map((level) => ({
  value: level,
  label: sanctionLevelLabel(level),
}))

const LEVEL_FILTER_OPTIONS = [{ value: '', label: 'Alle Stufen' }, ...LEVEL_OPTIONS]

const STATUS_OPTIONS = [
  { value: 'ISSUED', label: 'Ausgesprochen' },
  { value: 'EXECUTED', label: 'Vollzogen' },
  { value: 'IN_COURT', label: 'Einspruch / Klage' },
  { value: 'UPHELD', label: 'Bestätigt' },
  { value: 'REVOKED', label: 'Aufgehoben' },
  { value: '', label: 'Alle Status' },
]

/** Agent-Daten für die Karte — fällt auf den Snapshot zurück, wenn das Profil gelöscht wurde. */
function cardAgent(sanction: SanctionListItem): SanctionCardAgent {
  if (sanction.agent) {
    return {
      id: sanction.agent.id,
      firstName: sanction.agent.firstName,
      lastName: sanction.agent.lastName,
      badgeNumber: sanction.agent.badgeNumber,
      rankName: sanction.agent.rank?.name ?? null,
    }
  }
  return {
    id: null,
    firstName: sanction.previousFirstName ?? 'Unbekannter',
    lastName: sanction.previousLastName ?? 'Agent',
    badgeNumber: sanction.previousBadgeNumber,
    rankName: sanction.previousRank,
  }
}

/** Offen = noch nicht abschließend entschieden. */
function isOpenSanction(sanction: SanctionListItem) {
  return sanction.status === 'ISSUED' || sanction.status === 'EXECUTED'
}

/**
 * Dringlichstes zuerst: noch nicht vollzogene vor allen anderen, dann die
 * schwerste Maßnahme, zuletzt das jüngste Datum.
 */
function compareSanctions(a: SanctionListItem, b: SanctionListItem) {
  const openA = isOpenSanction(a)
  const openB = isOpenSanction(b)
  if (openA !== openB) return openA ? -1 : 1
  if (openA && openB && a.level !== b.level) return b.level.localeCompare(a.level)
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

export default function SanktionenPage() {
  const { user } = useAuth()
  // Jeder eingeloggte Agent darf die Liste sehen — nur Verwalten braucht ein Recht.
  const canManage = hasPermission(user, 'sanctions:manage')
  const canConfirm = hasPermission(user, 'sanctions:confirm')
  const { data: sanctions, loading, error: loadError, refetch } = useFetch<SanctionListItem[]>('/api/sanctions')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('ISSUED')
  const [issuerFilter, setIssuerFilter] = useState('')

  const [editing, setEditing] = useState<SanctionListItem | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    penalGrade: '1',
    level: '01',
    violationCode: '',
    reason: '',
    penalty: '',
  })
  const [editChecklist, setEditChecklist] = useState<Record<string, boolean>>({})
  const [toDelete, setToDelete] = useState<SanctionListItem | null>(null)
  const [busy, setBusy] = useState(false)

  const issuerOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const sanction of sanctions ?? []) {
      if (sanction.issuedByUserId && sanction.issuedBy?.displayName) {
        byId.set(sanction.issuedByUserId, sanction.issuedBy.displayName)
      }
    }
    return [
      { value: '', label: 'Alle Aussteller' },
      ...Array.from(byId, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'de')),
    ]
  }, [sanctions])

  const filtered = useMemo(() => {
    if (!sanctions) return []
    const needle = search.trim().toLowerCase()

    return sanctions
      .filter((sanction) => {
        if (statusFilter && sanction.status !== statusFilter) return false
        if (gradeFilter && sanction.penalGrade !== gradeFilter) return false
        if (levelFilter && sanction.level !== levelFilter) return false
        if (issuerFilter && sanction.issuedByUserId !== issuerFilter) return false
        if (!needle) return true

        const agent = cardAgent(sanction)
        const haystack = [
          `${agent.firstName} ${agent.lastName}`,
          displayBadgeNumber(agent.badgeNumber),
          agent.badgeNumber ?? '',
          agent.rankName ?? '',
          sanction.reason,
          sanction.penalty ?? '',
          resolveViolation(sanction.violationCode)?.label ?? '',
          sanctionLevelLabel(sanction.level),
          sanction.issuedBy?.displayName ?? '',
        ].join(' ').toLowerCase()
        return haystack.includes(needle)
      })
      .sort(compareSanctions)
  }, [sanctions, search, statusFilter, gradeFilter, levelFilter, issuerFilter])

  const stats = useMemo(() => {
    const all = sanctions ?? []
    const open = all.filter(isOpenSanction)
    return {
      open: open.length,
      pendingExecution: all.filter((sanction) => sanction.status === 'ISSUED').length,
      pendingConfirmation: all.filter(
        (sanction) => (sanction.penalGrade === '5' || sanction.penalGrade === '6') && !sanction.confirmedAt,
      ).length,
      severe: open.filter((sanction) => sanction.level >= '04').length,
    }
  }, [sanctions])

  const editViolations = useMemo(
    () => (isPenalGrade(editForm.penalGrade) ? violationsForGrade(editForm.penalGrade) : []),
    [editForm.penalGrade],
  )
  const editLevelRule = isSanctionLevel(editForm.level) ? SANCTION_LEVELS[editForm.level] : null
  const editChecklistComplete = DECISION_CHECKLIST.every((item) => editChecklist[item.key])

  const runAction = async (label: string, request: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await request()
      addToast({ type: 'success', title: label })
      await refetch()
      return true
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    execute(`/api/sanctions/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

  const handleExecute = (id: string) =>
    runAction('Maßnahme als vollzogen vermerkt', () => patch(id, { action: 'EXECUTE' }))

  const handleConfirm = (id: string) =>
    runAction('Sanktion bestätigt', () => patch(id, { action: 'CONFIRM' }))

  const handleRevoke = (id: string) =>
    runAction('Sanktion aufgehoben', () => patch(id, { action: 'REVOKE' }))

  const openEdit = (sanction: SanctionListItem) => {
    setEditing(sanction)
    setEditForm({
      penalGrade: isPenalGrade(sanction.penalGrade) ? sanction.penalGrade : '1',
      level: isSanctionLevel(sanction.level) ? sanction.level : '01',
      violationCode: sanction.violationCode ?? '',
      reason: sanction.reason,
      penalty: sanction.penalty ?? '',
    })
    // Der Entscheidungs-Check wird bei jeder Änderung neu bestätigt.
    setEditChecklist({})
  }

  /** Grade-Wechsel setzt Stufe und Verstoß auf die Regelsanktion des neuen Grades. */
  const handleGradeChange = (penalGrade: string) => {
    const rule = isPenalGrade(penalGrade) ? PENAL_GRADE_RULES[penalGrade] : null
    setEditForm((current) => ({
      ...current,
      penalGrade,
      level: rule ? rule.regularLevels[0] : current.level,
      violationCode: '',
    }))
  }

  const handleSaveEdit = async () => {
    if (!editing || !editForm.reason.trim() || !editChecklistComplete) return
    const ok = await runAction('Sanktion aktualisiert', () =>
      patch(editing.id, {
        penalGrade: editForm.penalGrade,
        level: editForm.level,
        violationCode: editForm.violationCode || null,
        reason: editForm.reason.trim(),
        penalty: editForm.penalty.trim(),
        checklist: editChecklist,
      }),
    )
    if (ok) setEditing(null)
  }

  const handleDelete = async () => {
    if (!toDelete) return
    const ok = await runAction('Sanktion gelöscht', () =>
      execute(`/api/sanctions/${toDelete.id}`, { method: 'DELETE' }),
    )
    if (ok) setToDelete(null)
  }

  if (loading) return <PageLoader />

  const filterClass =
    'h-[36px] sm:h-[34px] px-3 rounded-[8px] text-[13px] bg-[#1d1d1d] text-[#c3c3c3] border border-[#343434]/50 focus:outline-none focus:border-[#d4d4d4] transition-all'

  return (
    <div>
      <PageHeader
        title="Sanktionen"
        eyebrow="Übersicht"
        description="Alle Sanktionen des Departments nach dem Sanktionskatalog v1.0 — filterbar nach Agent, Penal Grade, Stufe, Status und Aussteller."
      />

      {loadError ? (
        <div className="glass-panel-elevated rounded-[14px] px-5 py-12 text-center">
          <AlertTriangle size={26} className="mx-auto mb-3 text-[#f87171]" strokeWidth={1.5} />
          <p className="text-[13px] text-[#fca5a5]">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => void refetch()}>
            Erneut laden
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Laufende Sanktionen" value={String(stats.open)} tone="open" />
            <StatTile label="Vollzug ausstehend" value={String(stats.pendingExecution)} tone="neutral" />
            <StatTile
              label="Bestätigung ausstehend"
              value={String(stats.pendingConfirmation)}
              tone={stats.pendingConfirmation > 0 ? 'alert' : 'neutral'}
            />
            <StatTile label="Ab Stufe 04" value={String(stats.severe)} tone={stats.severe > 0 ? 'alert' : 'neutral'} />
          </div>

          <div className="mb-5 flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#808080]" strokeWidth={1.75} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Suche nach Name, Dienstnummer, Rang, Verstoß oder Grund..."
                className={cn(filterClass, 'w-full pl-9 placeholder:text-[#808080]')}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
              <Select size="sm" value={statusFilter} onValueChange={setStatusFilter} options={STATUS_OPTIONS} className="lg:w-[185px]" />
              <Select size="sm" value={gradeFilter} onValueChange={setGradeFilter} options={PENAL_GRADE_OPTIONS} className="lg:w-[190px]" />
              <Select size="sm" value={levelFilter} onValueChange={setLevelFilter} options={LEVEL_FILTER_OPTIONS} className="lg:w-[210px]" />
              <Select size="sm" value={issuerFilter} onValueChange={setIssuerFilter} options={issuerOptions} className="lg:w-[175px]" />
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#808080]">
              {filtered.length} von {sanctions?.length ?? 0} Sanktionen
            </p>
            {(sanctions?.length ?? 0) >= 1000 && (
              <p className="text-[11.5px] text-[#b45309]">Nur die 1000 neuesten Sanktionen werden geladen.</p>
            )}
          </div>

          {filtered.length > 0 ? (
            <div className="space-y-2.5">
              {filtered.map((sanction, i) => (
                <motion.div
                  key={sanction.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3) }}
                >
                  <SanctionCard
                    sanction={sanction}
                    agent={cardAgent(sanction)}
                    canSanction={canManage && !busy}
                    canConfirm={canConfirm}
                    variant={isOpenSanction(sanction) ? 'open' : 'history'}
                    onExecute={sanction.status === 'ISSUED' ? () => void handleExecute(sanction.id) : undefined}
                    onConfirm={() => void handleConfirm(sanction.id)}
                    onRevoke={isOpenSanction(sanction) ? () => void handleRevoke(sanction.id) : undefined}
                    onEdit={() => openEdit(sanction)}
                    onDelete={() => setToDelete(sanction)}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="glass-panel-elevated rounded-[14px] py-20 text-center">
              <Gavel size={28} className="mx-auto mb-3 text-[#333]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#999]">
                {sanctions && sanctions.length > 0 ? 'Keine Treffer für die aktuellen Filter' : 'Keine Sanktionen vorhanden'}
              </p>
            </div>
          )}
        </>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Sanktion bearbeiten">
        {editing && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-[10px] border border-[#343434]/60 bg-[#1c1c1c]/70 px-3.5 py-3">
              <Gavel size={15} className="text-[#f59e0b] shrink-0" strokeWidth={1.75} />
              <p className="text-[13px] text-[#aeaeae]">
                Sanktion bearbeiten für{' '}
                <strong className="font-semibold text-[#eee]">
                  {cardAgent(editing).firstName} {cardAgent(editing).lastName}
                </strong>
              </p>
            </div>

            <Select
              label="Penal Grade"
              value={editForm.penalGrade}
              onValueChange={handleGradeChange}
              options={EDIT_PENAL_GRADE_OPTIONS}
            />

            {isPenalGrade(editForm.penalGrade) && (
              <div className="rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 py-2.5">
                <p className="text-[12.5px] font-medium text-[#aeaeae]">
                  {PENAL_GRADE_RULES[editForm.penalGrade].severity}
                </p>
                <p className="mt-1 text-[13px] leading-snug text-[#f4f4f4]">
                  {PENAL_GRADE_RULES[editForm.penalGrade].description}
                </p>
                <p className="mt-1.5 text-[12px] text-[#808080]">
                  Regelsanktion: {PENAL_GRADE_RULES[editForm.penalGrade].typicalConsequence}
                </p>
              </div>
            )}

            <Select
              label="Verstoß"
              value={editForm.violationCode}
              onValueChange={(violationCode) => setEditForm({ ...editForm, violationCode })}
              options={[
                { value: '', label: 'Kein Katalog-Verstoß' },
                ...editViolations.map((item) => ({ value: item.code, label: item.label })),
              ]}
            />

            <Select
              label="Sanktionsstufe"
              value={editForm.level}
              onValueChange={(level) => setEditForm({ ...editForm, level })}
              options={LEVEL_OPTIONS}
            />

            {editLevelRule && (
              <div className="rounded-[9px] border border-[#343434]/70 bg-[#181818]/60 px-3 py-2.5">
                <p className="text-[12.5px] font-medium text-[#aeaeae]">Anwendung</p>
                <p className="mt-1 text-[13px] leading-snug text-[#f4f4f4]">{editLevelRule.application}</p>
              </div>
            )}

            <Textarea
              label="Grund *"
              value={editForm.reason}
              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
              rows={4}
              required
              placeholder="Detaillierter Grund der Sanktion..."
            />

            <Textarea
              label="Weitere Folge"
              value={editForm.penalty}
              onChange={(e) => setEditForm({ ...editForm, penalty: e.target.value })}
              rows={2}
              placeholder="Zusätzliche Auflagen oder Folgen (optional)..."
            />

            <div className="rounded-[10px] border border-[#343434]/70 bg-[#181818]/60 px-3.5 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#808080]">
                Entscheidungs-Check
              </p>
              <div className="space-y-1.5">
                {DECISION_CHECKLIST.map((item) => (
                  <label key={item.key} className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={editChecklist[item.key] ?? false}
                      onChange={(e) => setEditChecklist((current) => ({ ...current, [item.key]: e.target.checked }))}
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 accent-[#f59e0b]"
                    />
                    <span className="text-[12.5px] leading-snug text-[#c3c3c3]">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>Abbrechen</Button>
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={busy || !editForm.reason.trim() || !editChecklistComplete}
              >
                <Gavel size={13} strokeWidth={2} /> Speichern
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!toDelete} onClose={() => setToDelete(null)} title="Sanktion löschen">
        {toDelete && (
          <div className="space-y-4">
            <div className="rounded-[10px] border border-[#343434]/60 bg-[#1c1c1c]/70 px-3.5 py-3">
              <p className="text-[13px] font-semibold text-[#eee]">
                {cardAgent(toDelete).firstName} {cardAgent(toDelete).lastName} · {penalGradeLabel(toDelete.penalGrade)}
              </p>
              <p className="mt-1 text-[12.5px] text-[#a6a6a6]">{toDelete.reason}</p>
            </div>
            <p className="text-[12.5px] text-[#aeaeae]">Diese Sanktion wird dauerhaft gelöscht.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => setToDelete(null)}>Abbrechen</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={busy}>Löschen</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: 'open' | 'alert' | 'gold' | 'neutral' }) {
  const toneClass = {
    open: 'text-[#fbbf24]',
    alert: 'text-[#fca5a5]',
    gold: 'text-[#d4d4d4]',
    neutral: 'text-[#f4f4f4]',
  }[tone]

  return (
    <div className="glass-panel-elevated rounded-[12px] px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#808080]">{label}</p>
      <p className={cn('mt-1 text-[19px] font-semibold tabular-nums', toneClass)}>{value}</p>
    </div>
  )
}
