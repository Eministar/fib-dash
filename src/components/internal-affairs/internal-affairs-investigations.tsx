'use client'

import { InternalAffairsDawsWorkspace } from '@/components/internal-affairs/internal-affairs-daws'
import { InternalAffairsNavigation } from '@/components/internal-affairs/internal-affairs-navigation'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

export function InternalAffairsInvestigations() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'internal-affairs:view')
  const canManage = hasPermission(user, 'internal-affairs:manage')

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-7xl pb-2">
      <InternalAffairsNavigation active="investigations" />
      <InternalAffairsDawsWorkspace canManage={canManage} />
    </div>
  )
}
