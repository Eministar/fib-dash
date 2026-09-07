'use client'

import { useState } from 'react'
import { CalendarDays, FileText, ListChecks } from 'lucide-react'
import { ModuleDocuments } from '@/components/modules/module-documents'
import { ModuleCalendar, type ModuleCalendarKey } from '@/components/modules/module-calendar'
import { TaskBoard } from '@/components/tasks/task-board'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission, type Permission } from '@/lib/permissions'
import { cn } from '@/lib/utils'

type Tab = 'documents' | 'tasks' | 'calendar'

interface ModuleWorkspaceProps {
  module: ModuleCalendarKey
  title: string
  documentTitle: string
  documentDescription: string
  emptyDocument: string
  taskTitle: string
  taskDescription: string
  taskAccentLabel: string
  calendarTitle: string
  calendarDescription: string
  calendarEmptyLabel: string
  createToastTitle: string
  deleteToastTitle: string
  eventTypes: { value: string; label: string }[]
  defaultType: string
  color: string
  viewPermission: Permission
  managePermission: Permission
}

const tabs = [
  { id: 'documents' as const, label: 'Dokumente', icon: FileText },
  { id: 'tasks' as const, label: 'Aufgaben', icon: ListChecks },
  { id: 'calendar' as const, label: 'Kalender', icon: CalendarDays },
]

export function ModuleWorkspace({
  module,
  title,
  documentTitle,
  documentDescription,
  emptyDocument,
  taskTitle,
  taskDescription,
  taskAccentLabel,
  calendarTitle,
  calendarDescription,
  calendarEmptyLabel,
  createToastTitle,
  deleteToastTitle,
  eventTypes,
  defaultType,
  color,
  viewPermission,
  managePermission,
}: ModuleWorkspaceProps) {
  const { user } = useAuth()
  const canView = hasPermission(user, viewPermission)
  const canManage = hasPermission(user, managePermission)
  const [activeTab, setActiveTab] = useState<Tab>('documents')

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="max-w-6xl mx-auto pb-2">
      <div className="mb-5 flex flex-wrap gap-2" aria-label={`${title} Bereiche`}>
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
          module={module}
          title={documentTitle}
          description={documentDescription}
          emptyDocument={emptyDocument}
          canManage={canManage}
        />
      )}
      {activeTab === 'tasks' && (
        <TaskBoard
          module={module}
          title={taskTitle}
          description={taskDescription}
          accentLabel={taskAccentLabel}
          viewPermission={viewPermission}
          managePermission={managePermission}
        />
      )}
      {activeTab === 'calendar' && (
        <ModuleCalendar
          module={module}
          title={calendarTitle}
          description={calendarDescription}
          emptyLabel={calendarEmptyLabel}
          createToastTitle={createToastTitle}
          deleteToastTitle={deleteToastTitle}
          eventTypes={eventTypes}
          defaultType={defaultType}
          color={color}
          canManage={canManage}
        />
      )}
    </div>
  )
}
