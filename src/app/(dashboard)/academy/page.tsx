'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/ui/loading'

import { useState } from 'react'
import { CalendarDays, FileQuestion, FileText, FolderOpen, GraduationCap, ListChecks } from 'lucide-react'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'

const TaskBoard = dynamic(() => import('@/components/tasks/task-board').then(mod => mod.TaskBoard), { loading: () => <PageLoader /> })
const ModuleDocuments = dynamic(() => import('@/components/modules/module-documents').then(mod => mod.ModuleDocuments), { loading: () => <PageLoader /> })
const ModuleCalendar = dynamic(() => import('@/components/modules/module-calendar').then(mod => mod.ModuleCalendar), { loading: () => <PageLoader /> })
const AcademyResources = dynamic(() => import('@/components/modules/academy-resources').then(mod => mod.AcademyResources), { loading: () => <PageLoader /> })
const FormTests = dynamic(() => import('@/components/modules/form-tests').then(mod => mod.FormTests), { loading: () => <PageLoader /> })

type Tab = 'documents' | 'files' | 'training' | 'tests' | 'tasks' | 'calendar'

const tabs = [
  { id: 'documents' as const, label: 'Dokumente', icon: FileText },
  { id: 'files' as const, label: 'Dateien', icon: FolderOpen },
  { id: 'training' as const, label: 'Ausbildungen', icon: GraduationCap },
  { id: 'tests' as const, label: 'Tests', icon: FileQuestion },
  { id: 'tasks' as const, label: 'Aufgaben', icon: ListChecks },
  { id: 'calendar' as const, label: 'Kalender', icon: CalendarDays },
]

const EMPTY_ACADEMY_DOCUMENT = `# Neues Academy-Dokument

## Thema

- Ausbildungsziel
- Voraussetzungen

## Ablauf

| Abschnitt | Inhalt | Status |
| --- | --- | --- |
|  |  | Offen |

## Notizen

`

export default function AcademyPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'academy:view')
  const canManage = hasPermission(user, 'academy:manage')
  const canManageTests = hasPermission(user, 'academy-tests:manage')
  const [activeTab, setActiveTab] = useState<Tab>('documents')

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
          module="ACADEMY"
          title="Academy Dokumente"
          description="Interne Ausbildungsunterlagen, Leitfäden und Vorlagen für Academy"
          emptyDocument={EMPTY_ACADEMY_DOCUMENT}
          canManage={canManage}
        />
      )}
      {activeTab === 'files' && <AcademyResources mode="files" canManage={canManage} />}
      {activeTab === 'training' && <AcademyResources mode="training" canManage={canManage} />}
      {activeTab === 'tests' && (
        <FormTests
          module="ACADEMY"
          title="Academy Tests"
          description="Tests und Fragebögen für Bewerbungen, Trainings, Prüfungen und Schulungen."
          canManage={canManageTests}
        />
      )}
      {activeTab === 'tasks' && (
        <TaskBoard
          module="ACADEMY"
          title="Academy"
          description="Ausbildungsaufgaben & To-Do-Listen für Cadets, Field Training und Schulungen."
          accentLabel="Ausbildung & Schulung"
          viewPermission="academy:view"
          managePermission="academy:manage"
        />
      )}
      {activeTab === 'calendar' && (
        <ModuleCalendar
          module="ACADEMY"
          title="Academy Kalender"
          description="Trainings, Prüfungen und Schulungstermine"
          emptyLabel="Keine Academy-Termine vorhanden"
          createToastTitle="Academy-Termin erstellt"
          deleteToastTitle="Academy-Termin gelöscht"
          eventTypes={[
            { value: 'ACADEMY', label: 'Academy' },
            { value: 'TRAINING', label: 'Training' },
            { value: 'EXAM', label: 'Prüfung' },
            { value: 'MEETING', label: 'Besprechung' },
            { value: 'OTHER', label: 'Sonstiges' },
          ]}
          defaultType="ACADEMY"
          color="#d4d4d4"
          canManage={canManage}
        />
      )}
    </div>
  )
}
