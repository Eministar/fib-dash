'use client'

import { FileQuestion } from 'lucide-react'
import { StatusPageFrame, StatusLink } from '@/components/layout/status-page-frame'

export function NotFoundContent() {
  return (
    <StatusPageFrame
      icon={FileQuestion}
      kicker="Nicht gefunden"
      code="404"
      title="Seite nicht gefunden"
      description="Diese Seite existiert nicht, wurde verschoben oder der Link ist veraltet."
    >
      <div className="mt-6 flex flex-col gap-2.5">
        <StatusLink href="/" variant="primary">Zum Dashboard</StatusLink>
        <StatusLink href="/login" variant="secondary">Zur Anmeldung</StatusLink>
      </div>
    </StatusPageFrame>
  )
}
