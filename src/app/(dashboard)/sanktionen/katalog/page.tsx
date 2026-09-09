'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Gavel,
  Layers,
  ListChecks,
  Quote,
  Repeat,
  Scale,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/hooks/use-fetch'
import { cn } from '@/lib/utils'

interface CatalogViolation {
  code: string
  grade: string
  label: string
}

interface CatalogGrade {
  grade: string
  severity: string
  description: string
  typicalConsequence: string
  regularLevels: string[]
  repeatConsequence: string
  violations: CatalogViolation[]
}

interface CatalogLevel {
  level: string
  measure: string
  application: string
  terminates: boolean
  suspends: boolean
  demotes: boolean
  authorityLabel: string | null
  minRankSortOrder: number | null
  minRankName: string | null
  /** Darf der aufrufende Account diese Stufe aussprechen? `null` = kein Rang bekannt. */
  allowedForActor: boolean | null
}

interface CatalogPayload {
  version: string
  principle: string
  grades: CatalogGrade[]
  levels: CatalogLevel[]
  repeatRules: { occurrence: number; principle: string }[]
  mitigating: string[]
  aggravating: string[]
  procedure: { step: number; title: string; detail: string }[]
  checklist: { key: string; label: string }[]
  actorRank: { name: string; sortOrder: number } | null
}

/** Farbwelt je Penal Grade — von sachlich (1) bis alarmierend (6). */
const GRADE_TONE: Record<string, { border: string; bg: string; text: string; accent: string }> = {
  '1': { border: 'border-[#38bdf8]/25', bg: 'bg-[#38bdf8]/[0.06]', text: 'text-[#7dd3fc]', accent: 'bg-[#38bdf8]' },
  '2': { border: 'border-[#22d3ee]/25', bg: 'bg-[#22d3ee]/[0.06]', text: 'text-[#67e8f9]', accent: 'bg-[#22d3ee]' },
  '3': { border: 'border-[#facc15]/25', bg: 'bg-[#facc15]/[0.06]', text: 'text-[#fde047]', accent: 'bg-[#facc15]' },
  '4': { border: 'border-[#f59e0b]/30', bg: 'bg-[#f59e0b]/[0.07]', text: 'text-[#fcd34d]', accent: 'bg-[#f59e0b]' },
  '5': { border: 'border-[#f97316]/30', bg: 'bg-[#f97316]/[0.07]', text: 'text-[#fdba74]', accent: 'bg-[#f97316]' },
  '6': { border: 'border-[#dc2626]/35', bg: 'bg-[#dc2626]/[0.08]', text: 'text-[#fca5a5]', accent: 'bg-[#dc2626]' },
}

function toneFor(grade: string) {
  return GRADE_TONE[grade] ?? GRADE_TONE['1']
}

const SECTIONS = [
  { id: 'grades', label: '01 · Penal Grades', icon: Layers },
  { id: 'levels', label: '02 · Sanktionsstufen', icon: Scale },
  { id: 'violations', label: '03 · Verstöße', icon: Gavel },
  { id: 'repeat', label: '04 · Wiederholung', icon: Repeat },
  { id: 'authorities', label: '05 · Zuständigkeiten', icon: UserCheck },
  { id: 'procedure', label: '06 · Verfahren', icon: ListChecks },
  { id: 'checklist', label: '07 · Entscheidungs-Check', icon: ClipboardCheck },
]

export default function SanktionskatalogPage() {
  const { data, loading, error } = useFetch<CatalogPayload>('/api/sanctions/catalog')
  const [activeGrade, setActiveGrade] = useState<string>('1')

  const selectedGrade = useMemo(
    () => data?.grades.find((grade) => grade.grade === activeGrade) ?? data?.grades[0] ?? null,
    [data, activeGrade],
  )

  if (loading) return <PageLoader />

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Sanktionskatalog" eyebrow="Interner Dienststandard" />
        <div className="glass-panel-elevated rounded-[14px] px-5 py-12 text-center">
          <AlertTriangle size={26} className="mx-auto mb-3 text-[#f87171]" strokeWidth={1.5} />
          <p className="text-[13px] text-[#fca5a5]">{error ?? 'Katalog konnte nicht geladen werden'}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Sanktionskatalog"
        eyebrow="Interner Dienststandard · FIB"
        description="Klar. Einheitlich. Verhältnismäßig. Leitfaden zur Einstufung, Sanktionierung und Dokumentation von Fehlverhalten innerhalb des Federal Investigation Bureau."
      />

      {/* Ablauf in vier Schritten */}
      <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { step: '01', title: 'Verstoß', detail: 'Sachverhalt feststellen' },
          { step: '02', title: 'Penal Grade', detail: 'Schwere einstufen' },
          { step: '03', title: 'Sanktion', detail: 'Maßnahme bestimmen' },
          { step: '04', title: 'Dokumentation', detail: 'Entscheidung festhalten' },
        ].map((item, i) => (
          <motion.div
            key={item.step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04 }}
            className="glass-panel-elevated rounded-[12px] px-4 py-3"
          >
            <p className="text-[11px] font-semibold tabular-nums tracking-[0.14em] text-[#f59e0b]">{item.step}</p>
            <p className="mt-1 text-[13.5px] font-semibold text-[#f4f4f4]">{item.title}</p>
            <p className="mt-0.5 text-[12px] text-[#808080]">{item.detail}</p>
          </motion.div>
        ))}
      </div>

      {/* Geltung */}
      <div className="mb-5 rounded-[12px] border border-[#343434]/60 bg-[#181818]/50 px-4 py-3.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#808080]">Gültigkeit & Grundsatz</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#a6a6a6]">
          Dieser Katalog dient als interner Orientierungs- und Entscheidungsrahmen. Maßgeblich bleiben die jeweils
          geltenden Dienstvorschriften. Sanktionen sind stets nach dem Grundsatz der Verhältnismäßigkeit zu wählen.
        </p>
      </div>

      {/* Sprungmarken */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="flex items-center gap-1.5 rounded-[8px] border border-[#343434]/50 bg-[#1d1d1d] px-2.5 py-1.5 text-[12px] text-[#c3c3c3] transition-colors hover:border-[#d4d4d4]/40 hover:text-[#f4f4f4]"
          >
            <section.icon size={12} strokeWidth={1.8} />
            {section.label}
          </a>
        ))}
      </div>

      {/* 01 — Penal Grades */}
      <Section id="grades" number="01" title="Penal Grades" icon={Layers}
        intro="Die Penal Grades bilden die sechs Schweregrade des Katalogs. Je höher der Grade, desto größer die Auswirkungen auf Vertrauen, Dienstbetrieb und Personalmaßnahmen.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#343434]/60">
                <Th>PG</Th>
                <Th>Schwere</Th>
                <Th>Kurzbeschreibung</Th>
                <Th>Typische Folge</Th>
              </tr>
            </thead>
            <tbody>
              {data.grades.map((grade) => {
                const tone = toneFor(grade.grade)
                return (
                  <tr key={grade.grade} className="border-b border-[#262626]/70 last:border-0">
                    <td className="py-2.5 pr-3">
                      <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-[7px] border text-[12px] font-bold tabular-nums', tone.border, tone.bg, tone.text)}>
                        {grade.grade}
                      </span>
                    </td>
                    <Td className={cn('font-semibold', tone.text)}>{grade.severity}</Td>
                    <Td>{grade.description}</Td>
                    <Td>{grade.typicalConsequence}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 02 — Sanktionsstufen */}
      <Section id="levels" number="02" title="Sanktionsstufen" icon={Scale}>
        <div className="space-y-2">
          {data.levels.map((level) => (
            <div
              key={level.level}
              className={cn(
                'flex flex-col gap-2 rounded-[10px] border px-3.5 py-3 sm:flex-row sm:items-start sm:gap-4',
                level.terminates ? 'border-[#dc2626]/25 bg-[#dc2626]/[0.05]' : 'border-[#343434]/60 bg-[#181818]/50',
              )}
            >
              <span className="shrink-0 text-[13px] font-bold tabular-nums text-[#f59e0b]">{level.level}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-[#f4f4f4]">{level.measure}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#a6a6a6]">{level.application}</p>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="text-[11.5px] text-[#808080]">{level.authorityLabel ?? '—'}</p>
                {level.minRankName && (
                  <p className="mt-0.5 text-[11px] text-[#686868]">ab {level.minRankName}</p>
                )}
                {level.allowedForActor !== null && (
                  <span
                    className={cn(
                      'mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10.5px] font-medium',
                      level.allowedForActor
                        ? 'border-[#166534]/60 bg-[#052e1a]/60 text-[#86efac]'
                        : 'border-[#404040]/70 bg-[#141414]/70 text-[#a3a3a3]',
                    )}
                  >
                    {level.allowedForActor ? <CheckCircle2 size={10} strokeWidth={2.2} /> : null}
                    {level.allowedForActor ? 'Für dich zulässig' : 'Nicht in deiner Zuständigkeit'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {data.actorRank === null && (
          <p className="mt-3 rounded-[9px] border border-[#b45309]/40 bg-[#1d1608]/50 px-3 py-2.5 text-[12px] text-[#fbbf24]">
            Diesem Account ist keine Personalakte zugeordnet — die Zuständigkeit lässt sich nicht anhand des Ranges prüfen.
          </p>
        )}
      </Section>

      {/* 03 — Verstöße nach Schwere */}
      <Section id="violations" number="03" title="Verstöße nach Schwere" icon={Gavel}
        intro="Die Beispiele sind eine Auswahl und nicht abschließend. Sie dienen der einheitlichen Einstufung vergleichbarer Sachverhalte.">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {data.grades.map((grade) => {
            const tone = toneFor(grade.grade)
            const active = selectedGrade?.grade === grade.grade
            return (
              <button
                key={grade.grade}
                onClick={() => setActiveGrade(grade.grade)}
                className={cn(
                  'rounded-[8px] border px-3 py-1.5 text-[12px] font-medium transition-colors',
                  active
                    ? cn(tone.border, tone.bg, tone.text)
                    : 'border-[#343434]/50 bg-[#1d1d1d] text-[#a6a6a6] hover:text-[#f4f4f4]',
                )}
              >
                PG {grade.grade} · {grade.severity}
              </button>
            )
          })}
        </div>

        {selectedGrade && (
          <motion.div
            key={selectedGrade.grade}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('rounded-[12px] border p-4', toneFor(selectedGrade.grade).border, toneFor(selectedGrade.grade).bg)}
          >
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h4 className={cn('text-[14px] font-bold', toneFor(selectedGrade.grade).text)}>
                Penal Grade {selectedGrade.grade} · {selectedGrade.severity}
              </h4>
              <span className="text-[12px] text-[#a6a6a6]">{selectedGrade.description}</span>
            </div>

            <ul className="grid gap-1.5 sm:grid-cols-2">
              {selectedGrade.violations.map((violation) => (
                <li key={violation.code} className="flex items-start gap-2 text-[12.5px] leading-snug text-[#c3c3c3]">
                  <span className={cn('mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full', toneFor(selectedGrade.grade).accent)} />
                  {violation.label}
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#808080]">Regelsanktion</p>
                <p className="mt-0.5 text-[13px] font-semibold text-[#f4f4f4]">
                  {selectedGrade.regularLevels
                    .map((level) => data.levels.find((item) => item.level === level)?.measure ?? level)
                    .join(' / ')}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#808080]">Bei Wiederholung</p>
                <p className="mt-0.5 text-[13px] font-semibold text-[#f4f4f4]">{selectedGrade.repeatConsequence}</p>
              </div>
            </div>
          </motion.div>
        )}
      </Section>

      {/* 04 — Wiederholungsfälle */}
      <Section id="repeat" number="04" title="Wiederholungsfälle" icon={Repeat}
        intro="Wiederholtes Fehlverhalten wird grundsätzlich strenger bewertet. Entscheidend sind Gleichartigkeit, zeitlicher Abstand, Vorsatz und die bisherigen Disziplinarmaßnahmen.">
        <div className="mb-4 space-y-2">
          {data.repeatRules.map((rule) => (
            <div key={rule.occurrence} className="flex items-center gap-3 rounded-[10px] border border-[#343434]/60 bg-[#181818]/50 px-3.5 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f59e0b]/15 text-[11.5px] font-bold tabular-nums text-[#fcd34d]">
                {rule.occurrence}
              </span>
              <p className="text-[12.5px] text-[#c3c3c3]">
                <span className="font-semibold text-[#f4f4f4]">
                  {rule.occurrence === 1 ? 'Erstverstoß' : `${rule.occurrence}. gleichartiger Verstoß`}
                </span>
                {' — '}{rule.principle}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <CircumstanceBox title="Mildernd" items={data.mitigating} tone="good" />
          <CircumstanceBox title="Erschwerend" items={data.aggravating} tone="bad" />
        </div>
      </Section>

      {/* 05 — Zuständigkeiten */}
      <Section id="authorities" number="05" title="Zuständigkeiten" icon={UserCheck}
        intro="Sanktionen werden nur durch die jeweils zuständige und unbefangene Stelle ausgesprochen. Niemand entscheidet über ein Verfahren gegen die eigene Person.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#343434]/60">
                <Th>Stelle</Th>
                <Th>Befugnis</Th>
                <Th>Mindestrang</Th>
              </tr>
            </thead>
            <tbody>
              {data.levels.map((level) => (
                <tr key={level.level} className="border-b border-[#262626]/70 last:border-0">
                  <Td className="font-medium text-[#f4f4f4]">{level.authorityLabel ?? '—'}</Td>
                  <Td>{level.level} · {level.measure}</Td>
                  <Td>{level.minRankName ?? `Rangstufe ${level.minRankSortOrder ?? '—'}`}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 06 — Disziplinarverfahren */}
      <Section id="procedure" number="06" title="Disziplinarverfahren" icon={ListChecks}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.procedure.map((step) => (
            <div key={step.step} className="rounded-[10px] border border-[#343434]/60 bg-[#181818]/50 px-3.5 py-3">
              <p className="text-[11px] font-semibold tabular-nums tracking-[0.14em] text-[#f59e0b]">
                {String(step.step).padStart(2, '0')}
              </p>
              <p className="mt-1 text-[13px] font-semibold text-[#f4f4f4]">{step.title}</p>
              <p className="mt-0.5 text-[12px] text-[#808080]">{step.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-[9px] border border-[#b45309]/40 bg-[#1d1608]/50 px-3 py-2.5 text-[12.5px] leading-relaxed text-[#fbbf24]">
          <ShieldCheck size={14} strokeWidth={1.9} className="mt-[1px] shrink-0" />
          Bei Penal Grade 5 und 6 bestätigt grundsätzlich eine zweite Führungskraft die Entscheidung. Bei Verfahren
          gegen Führungskräfte entscheidet die nächsthöhere, unbefangene Stelle.
        </p>
      </Section>

      {/* 07 — Entscheidungs-Check */}
      <Section id="checklist" number="07" title="Entscheidungs-Check" icon={ClipboardCheck}
        intro="Vor jeder Sanktion kurz prüfen. Im Ausstell-Dialog müssen alle Punkte bestätigt sein.">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.checklist.map((item) => (
            <li key={item.key} className="flex items-start gap-2.5 rounded-[9px] border border-[#343434]/50 bg-[#181818]/40 px-3 py-2">
              <CheckCircle2 size={13} strokeWidth={1.9} className="mt-[2px] shrink-0 text-[#686868]" />
              <span className="text-[12.5px] leading-snug text-[#c3c3c3]">{item.label}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* Merksatz */}
      <div className="mb-4 rounded-[14px] border border-[#f59e0b]/25 bg-[#f59e0b]/[0.05] px-5 py-5">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-[#fcd34d]">
          <Quote size={12} strokeWidth={2} /> Merksatz
        </p>
        <p className="text-[14px] font-medium leading-relaxed text-[#f4f4f4]">{data.principle}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <p className="text-[11.5px] text-[#686868]">
          {data.version} · Nur für den internen Dienstgebrauch
        </p>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          Drucken
        </Button>
      </div>
    </div>
  )
}

function Section({
  id,
  number,
  title,
  icon: Icon,
  intro,
  children,
}: {
  id: string
  number: string
  title: string
  icon: typeof Layers
  intro?: string
  children: React.ReactNode
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="glass-panel-elevated mb-4 scroll-mt-6 rounded-[14px] p-5"
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#212121]">
          <Icon size={14} strokeWidth={1.8} className="text-[#f59e0b]" />
        </span>
        <div>
          <p className="text-[10.5px] font-semibold tracking-[0.16em] text-[#686868]">{number}</p>
          <h3 className="text-[14px] font-semibold text-[#f4f4f4]">{title}</h3>
        </div>
      </div>
      {intro && <p className="mb-4 text-[12.5px] leading-relaxed text-[#a6a6a6]">{intro}</p>}
      {children}
    </motion.section>
  )
}

function CircumstanceBox({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'bad' }) {
  const cls = tone === 'good'
    ? { border: 'border-[#166534]/40', bg: 'bg-[#052e1a]/25', text: 'text-[#86efac]', dot: 'bg-[#16a34a]' }
    : { border: 'border-[#7f1d1d]/40', bg: 'bg-[#2a1212]/25', text: 'text-[#fca5a5]', dot: 'bg-[#dc2626]' }

  return (
    <div className={cn('rounded-[10px] border px-3.5 py-3', cls.border, cls.bg)}>
      <p className={cn('mb-2 text-[11px] font-medium uppercase tracking-[0.12em]', cls.text)}>{title}</p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[12.5px] leading-snug text-[#c3c3c3]">
            <span className={cn('mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full', cls.dot)} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="pb-2 pr-3 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[#808080]">
      {children}
    </th>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('py-2.5 pr-3 text-[12.5px] leading-snug text-[#a6a6a6]', className)}>{children}</td>
}
