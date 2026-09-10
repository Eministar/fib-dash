'use client'

import { UploadKeysManager } from '@/components/uploads/upload-keys-manager'
import { PageLoader } from '@/components/ui/loading'
import { useAuth } from '@/context/auth-context'
import { hasAnyPermission } from '@/lib/permissions'

export default function UploadKeysPage() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!hasAnyPermission(user, ['uploads:manage'])) {
    return <p className="p-8 text-sm text-[#909090]">Upload-Schlüssel darf nur verwalten, wer „uploads:manage“ besitzt.</p>
  }
  return <UploadKeysManager />
}
