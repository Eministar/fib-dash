'use client'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { AgreementsWorkspace } from '@/components/agreements/agreements-workspace'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

export default function AgreementsPage() {
  const { user } = useAuth()
  if (!hasPermission(user, 'agreements:view')) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-6xl pb-2">
      <PageHeader title="Verträge" description="Frei aufgesetzte Verträge mit beliebigen Parteien, unterschrieben per Link." />
      <AgreementsWorkspace canManage={hasPermission(user, 'agreements:manage')} />
    </div>
  )
}
