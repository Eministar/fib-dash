'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AgentSearches } from '@/components/internal-affairs/agent-searches'
import { InternalAffairsNavigation, type InternalAffairsSection } from '@/components/internal-affairs/internal-affairs-navigation'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { ModuleDocuments } from '@/components/modules/module-documents'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

const EMPTY_INTERNAL_AFFAIRS_DOCUMENT = `# Neuer Internal-Affairs-Bericht

## Sachverhalt

- Beteiligte
- Anlass

## Feststellungen

| Thema | Ergebnis | Maßnahme |
| --- | --- | --- |
|  |  |  |
`

export function InternalAffairsWorkspace() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const canView = hasPermission(user, 'internal-affairs:view')
  const canManage = hasPermission(user, 'internal-affairs:manage')
  const [activeTab, setActiveTab] = useState<Extract<InternalAffairsSection, 'documents' | 'searches'>>(
    searchParams.get('tab') === 'searches' ? 'searches' : 'documents',
  )

  useEffect(() => {
    setActiveTab(searchParams.get('tab') === 'searches' ? 'searches' : 'documents')
  }, [searchParams])

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <InternalAffairsNavigation active={activeTab} />

      {activeTab === 'documents' && (
        <ModuleDocuments
          module="INTERNAL_AFFAIRS"
          title="Internal Affairs Dokumente"
          description="Fallnotizen, Prüfberichte und interne Vorlagen der Internal Affairs"
          emptyDocument={EMPTY_INTERNAL_AFFAIRS_DOCUMENT}
          canManage={canManage}
        />
      )}
      {activeTab === 'searches' && <AgentSearches canManage={canManage} />}
    </div>
  )
}
