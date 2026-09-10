'use client'

import { UploadsWorkspace } from '@/components/uploads/uploads-workspace'
import { PageLoader } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { hasAnyPermission } from '@/lib/permissions'

export default function UploadsPage() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />

  const canView = hasAnyPermission(user, ['uploads:view', 'uploads:manage'])
  if (!canView) {
    return <p className="p-8 text-sm text-[#909090]">Für die Uploads fehlt dir die Berechtigung.</p>
  }
  return <UploadsWorkspace canManage={hasAnyPermission(user, ['uploads:manage'])} />
}
