'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { LegalAffairsNavigation, type LegalAffairsSection } from '@/components/legal-affairs/legal-affairs-navigation'
import { LegalCases } from '@/components/legal-affairs/legal-cases'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { ModuleDocuments } from '@/components/modules/module-documents'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

const EMPTY_LAD_DOCUMENT = `# Neues Dokument der Legal Affairs Division

## Gegenstand

- Beteiligte
- Anlass

## Vermerk

| Punkt | Stand | Nächstes Ziel |
| --- | --- | --- |
|  |  |  |
`

export function LegalAffairsWorkspace() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const canView = hasPermission(user, 'lad:view')
  const canManage = hasPermission(user, 'lad:manage')
  const [activeTab, setActiveTab] = useState<LegalAffairsSection>(
    searchParams.get('tab') === 'cases' ? 'cases' : 'documents',
  )

  useEffect(() => {
    setActiveTab(searchParams.get('tab') === 'cases' ? 'cases' : 'documents')
  }, [searchParams])

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <LegalAffairsNavigation active={activeTab} />

      {activeTab === 'documents' && (
        <ModuleDocuments
          module="LAD"
          title="Legal Affairs Dokumente"
          description="Rechtsvermerke, Fristen und interne Vorlagen der Legal Affairs Division"
          emptyDocument={EMPTY_LAD_DOCUMENT}
          canManage={canManage}
        />
      )}
      {activeTab === 'cases' && <LegalCases canManage={canManage} />}
    </div>
  )
}
