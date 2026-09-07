'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { StatusPageFrame, StatusLink } from '@/components/layout/status-page-frame'
import { Button } from '@/components/ui/button'
import { isChunkLoadProblem, reloadOnce } from '@/components/runtime/chunk-load-guard'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (isChunkLoadProblem(error)) {
      if (reloadOnce('ChunkLoadError im React-Error-Boundary erkannt — automatischer Reload nach Deploy.')) {
        return
      }
    }

    console.error(error)
    fetch('/api/runtime-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'App-Fehler',
        message: error?.message,
        digest: error?.digest,
        path: window.location.pathname,
        stack: error?.stack,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [error])

  return (
    <StatusPageFrame
      icon={AlertTriangle}
      kicker="Etwas ist schiefgelaufen"
      title="Fehler beim Laden"
      description={
        process.env.NODE_ENV === 'development' && error?.message
          ? error.message
          : 'Die Anwendung konnte diesen Inhalt nicht laden. Bitte versuche es erneut.'
      }
    >
      <div className="mt-6 flex flex-col gap-2.5">
        <Button type="button" onClick={reset} className="h-[38px] w-full">
          Erneut versuchen
        </Button>
        <StatusLink href="/" variant="secondary">Zum Dashboard</StatusLink>
      </div>
    </StatusPageFrame>
  )
}
