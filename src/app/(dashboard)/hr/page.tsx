'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, BookOpen, CalendarDays, ClipboardCheck, ClipboardList, FileQuestion, FileSignature, FileText, ListChecks, ScrollText, Settings } from 'lucide-react'
import { TaskBoard } from '@/components/tasks/task-board'
import { ModuleDocuments } from '@/components/modules/module-documents'
import { ModuleCalendar } from '@/components/modules/module-calendar'
import { FormTests } from '@/components/modules/form-tests'
import { HrApplications } from '@/components/applications/hr-applications'
import { ApplicationFormSettings } from '@/components/applications/application-form-settings'
import { ProbationsWorkspace } from '@/components/probations/probations-workspace'
import { ContractsWorkspace } from '@/components/contracts/contracts-workspace'
import { TransfersWorkspace } from '@/components/transfers/transfers-workspace'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'

type Tab = 'documents' | 'applications' | 'contracts' | 'transfers' | 'settings' | 'tests' | 'probations' | 'tasks' | 'calendar'

const tabs = [
  { id: 'documents' as const, label: 'Dokumente', icon: FileText },
  { id: 'applications' as const, label: 'Bewerbungen', icon: ClipboardList },
  { id: 'contracts' as const, label: 'Verträge', icon: FileSignature },
  { id: 'transfers' as const, label: 'Versetzungen', icon: ArrowLeftRight },
  { id: 'settings' as const, label: 'Einstellungen', icon: Settings },
  { id: 'tests' as const, label: 'Tests', icon: FileQuestion },
  { id: 'probations' as const, label: 'Probezeiten', icon: ClipboardCheck },
  { id: 'tasks' as const, label: 'Aufgaben', icon: ListChecks },
  { id: 'calendar' as const, label: 'Kalender', icon: CalendarDays },
]

function isTab(value: string | null): value is Tab {
  return !!value && tabs.some((tab) => tab.id === value)
}

const EMPTY_HR_DOCUMENT = `# Neues HR-Dokument

## Überblick

- Punkt 1
- Punkt 2

## Maßnahmen

| Thema | Status | Notiz |
| --- | --- | --- |
|  | Offen |  |
`

function HrLinks() {
  return (
    <div className="flex gap-1.5">
      <Link
        href="/ordnungen"
        className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] border border-[#404040] px-3 text-[12.5px] font-medium text-[#f4f4f4] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-150 hover:bg-[#232323]/50 active:scale-[0.98]"
      >
        <BookOpen size={14} strokeWidth={2} />
        Ordnungen
      </Link>
      <Link
        href="/ordnungen/sanktionskatalog"
        className="inline-flex h-[32px] items-center justify-center gap-1.5 rounded-[8px] border border-[#404040] px-3 text-[12.5px] font-medium text-[#f4f4f4] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-all duration-150 hover:bg-[#232323]/50 active:scale-[0.98]"
      >
        <ScrollText size={14} strokeWidth={2} />
        Sanktionskatalog
      </Link>
    </div>
  )
}

export default function HrDepartmentPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'hr:view')
  const canManage = hasPermission(user, 'hr:manage')
  const canManageTests = hasPermission(user, 'hr-tests:manage')
  const canManageContracts = hasPermission(user, 'contracts:manage')
  const [activeTab, setActiveTab] = useState<Tab>('documents')

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (isTab(tab)) setActiveTab(tab)
  }, [])

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="max-w-6xl mx-auto pb-2">
      <div className="mb-5 flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-[9px] border px-3 text-[12.5px] font-semibold transition-colors',
                active
                  ? 'border-[#d4d4d4]/45 bg-[#d4d4d4]/14 text-[#d4d4d4]'
                  : 'border-[#343434]/60 bg-[#181818]/55 text-[#a6a6a6] hover:border-[#404040] hover:text-white',
              )}
            >
              <Icon size={14} strokeWidth={2} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'documents' && (
        <ModuleDocuments
          module="HR"
          title="HR Dokumente"
          description="Interne Dokumente, Gesprächsnotizen und Vorlagen der Personalabteilung"
          emptyDocument={EMPTY_HR_DOCUMENT}
          canManage={canManage}
        />
      )}
      {activeTab === 'tests' && (
        <FormTests
          module="HR"
          title="HR Tests & Fragebögen"
          description="Tests und Fragebögen für Bewerbungen, Gespräche und interne HR-Auswertungen."
          canManage={canManageTests}
        />
      )}
      {activeTab === 'applications' && (
        <HrApplications canManage={canManage} />
      )}
      {activeTab === 'contracts' && (
        <ContractsWorkspace canManage={canManageContracts} />
      )}
      {activeTab === 'transfers' && (
        <TransfersWorkspace canManage={canManage} />
      )}
      {activeTab === 'settings' && (
        <ApplicationFormSettings canManage={canManage} />
      )}
      {activeTab === 'probations' && (
        <ProbationsWorkspace embedded />
      )}
      {activeTab === 'tasks' && (
        <TaskBoard
          module="HR"
          title="HR Abteilung"
          description="Aufgabenlisten der Personalabteilung – Onboarding, Gespräche, Audits und mehr."
          accentLabel="Personalabteilung"
          viewPermission="hr:view"
          managePermission="hr:manage"
          headerAction={<HrLinks />}
        />
      )}
      {activeTab === 'calendar' && (
        <ModuleCalendar
          module="HR"
          title="HR Kalender"
          description="Gespräche, Fristen und interne HR-Termine"
          emptyLabel="Keine HR-Termine vorhanden"
          createToastTitle="HR-Termin erstellt"
          deleteToastTitle="HR-Termin gelöscht"
          eventTypes={[
            { value: 'HR_DEADLINE', label: 'HR-Frist' },
            { value: 'MEETING', label: 'Besprechung' },
            { value: 'OTHER', label: 'Sonstiges' },
          ]}
          defaultType="HR_DEADLINE"
          color="#7c3aed"
          canManage={canManage}
        />
      )}
    </div>
  )
}
