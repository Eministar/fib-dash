'use client'

import { useState } from 'react'

import { Card } from '@/components/ui/card'
import { TabBar, type TabItem } from '@/components/ui/tab-bar'
import { useFetch } from '@/hooks/use-fetch'
import { lspdOfficerName, lspdStatusLabel, type LspdOfficerFile } from '@/lib/lspd-officers'
import { formatDate } from '@/lib/utils'

/** Stammdaten und Laufbahn eines LSPD-Beamten, live aus dem lspd-hr-Panel. */
export function LspdOfficerFilePanel({ officerId, file: given }: { officerId: string; file?: LspdOfficerFile | null }) {
  const { data, loading, error } = useFetch<LspdOfficerFile>(given ? null : `/api/lspd/officers/${officerId}`)
  const file = given ?? data

  if (!file) {
    return (
      <Card className="mb-4 py-6 text-center text-[12.5px] text-[#8e8e93]">
        {loading ? 'LSPD-Akte wird geladen …' : error || 'LSPD-Akte nicht verfügbar.'}
      </Card>
    )
  }
  return <LspdOfficerFileView file={file} />
}

/** Reine Anzeige – auch für die öffentliche Freigabeansicht nutzbar. */
export function LspdOfficerFileView({ file }: { file: LspdOfficerFile }) {
  const [tab, setTab] = useState('promotions')
  const tabs: TabItem[] = [
    { id: 'promotions', label: 'Beförderungen', count: file.promotions.length },
    { id: 'sanctions', label: 'Sanktionen', count: file.sanctions.length },
    { id: 'trainings', label: 'Trainings', count: file.trainings.filter((training) => training.completed).length },
    { id: 'terminations', label: 'Kündigungen', count: file.terminations.length },
  ]

  const facts: [string, string][] = [
    ['Dienstnummer', file.badgeNumber],
    ['Rang', file.rank.name],
    ['Status', lspdStatusLabel(file.status)],
    ['Eingestellt', formatDate(file.hireDate)],
    ['Units', file.units.map((unit) => unit.name).join(', ') || '—'],
    ['Discord-ID', file.discordId ?? '—'],
  ]

  return (
    <Card className="mb-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-white">LSPD-Akte · {lspdOfficerName(file)}</h2>
        <span className="text-[11.5px] text-[#8e8e93]">live aus dem LSPD-Panel</span>
      </div>
      <dl className="mb-4 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-[#8e8e93]">{label}</dt>
            <dd className="truncate text-[#e5e5ea]" title={value}>{value}</dd>
          </div>
        ))}
      </dl>

      <TabBar tabs={tabs} active={tab} onSelect={setTab} label="Laufbahn" />

      {tab === 'promotions' && (
        <List empty="Keine Rangänderungen.">
          {file.promotions.map((item, index) => (
            <Row key={index} at={item.at} title={`${item.fromRank} → ${item.toRank}`} detail={[item.fromBadge !== item.toBadge && item.toBadge ? `DN ${item.fromBadge ?? '—'} → ${item.toBadge}` : null, item.note].filter(Boolean).join(' · ')} />
          ))}
        </List>
      )}
      {tab === 'sanctions' && (
        <List empty="Keine Sanktionen.">
          {file.sanctions.map((item, index) => (
            <Row
              key={index}
              at={item.at}
              title={`${item.penalGrade} · ${item.reason}`}
              detail={[item.measureType, item.fineAmount ? `${item.fineAmount.toLocaleString('de-DE')} $` : null, item.penalty, item.status].filter(Boolean).join(' · ')}
            />
          ))}
        </List>
      )}
      {tab === 'trainings' && (
        <List empty="Keine Trainings hinterlegt.">
          {file.trainings.map((item) => (
            <li key={item.label} className="flex items-center justify-between py-2 text-[12.5px]">
              <span className="text-[#e5e5ea]">{item.label}</span>
              <span className={item.completed ? 'text-[#30d158]' : 'text-[#8e8e93]'}>{item.completed ? 'abgeschlossen' : 'offen'}</span>
            </li>
          ))}
        </List>
      )}
      {tab === 'terminations' && (
        <List empty="Keine Kündigungen.">
          {file.terminations.map((item, index) => (
            <Row key={index} at={item.at} title={item.reason} />
          ))}
        </List>
      )}
    </Card>
  )
}

function List({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="py-3 text-[12.5px] text-[#8e8e93]">{empty}</p>
  return <ul className="divide-y divide-[#2c2c2e]">{children}</ul>
}

function Row({ at, title, detail }: { at: string; title: string; detail?: string }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-[#e5e5ea]">{title}</span>
        <time dateTime={at} className="font-mono text-[11.5px] text-[#8e8e93]">{formatDate(at)}</time>
      </div>
      {detail && <p className="mt-0.5 text-[12px] text-[#98989d]">{detail}</p>}
    </li>
  )
}
