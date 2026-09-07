'use client'

import { InternalAffairsNavigation } from '@/components/internal-affairs/internal-affairs-navigation'
import { InternalAffairsTerminations } from '@/components/internal-affairs/internal-affairs-terminations'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

export function InternalAffairsTerminationsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'internal-affairs:view')

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="mx-auto max-w-7xl pb-2">
      <InternalAffairsNavigation active="terminations" />
      <InternalAffairsTerminations />
    </div>
  )
}
