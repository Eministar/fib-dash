'use client'

import { ShieldX } from 'lucide-react'
import { StatusPageFrame, StatusLink } from '@/components/layout/status-page-frame'

export function UnauthorizedContent() {
  return (
    <StatusPageFrame
      icon={ShieldX}
      kicker="Nicht berechtigt"
      code="401"
      title="Kein Zugriff"
      description="Du hast keine Berechtigung, diese Seite anzuzeigen. Bitte wende dich an die Administration, wenn du glaubst, dass es sich um einen Fehler handelt."
    >
      <div className="mt-6 flex flex-col gap-2.5">
        <StatusLink href="/" variant="primary">Zum Dashboard</StatusLink>
        <StatusLink href="/besucherportal" variant="secondary">Zum Besucherportal</StatusLink>
        <StatusLink href="/login" variant="secondary">Zur Anmeldung</StatusLink>
      </div>
    </StatusPageFrame>
  )
}
