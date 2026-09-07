'use client'

import { useEffect } from 'react'
import './globals.css'
import { ServerCrash } from 'lucide-react'
import { StatusPageFrame, StatusLink } from '@/components/layout/status-page-frame'
import { Button } from '@/components/ui/button'
import { isChunkLoadProblem, reloadOnce } from '@/components/runtime/chunk-load-guard'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (isChunkLoadProblem(error)) {
      if (reloadOnce('ChunkLoadError im Global-Error-Boundary erkannt — automatischer Reload nach Deploy.')) {
        return
      }
    }

    console.error(error)
    fetch('/api/runtime-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Schwerer App-Fehler',
        message: error?.message,
        digest: error?.digest,
        path: window.location.pathname,
        stack: error?.stack,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [error])

  return (
    <html lang="de" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[#080808] text-[#f4f4f4] font-sans" suppressHydrationWarning>
        <title>Schwerer Fehler · FIB</title>
        <StatusPageFrame
          icon={ServerCrash}
          kicker="Anwendung"
          code="500"
          title="Schwerer Fehler"
          description="Die Anwendung konnte nicht korrekt geladen werden. Bitte lade die Seite neu oder versuche es später erneut."
        >
          <div className="mt-6 flex flex-col gap-2.5">
            <Button type="button" onClick={reset} className="h-[38px] w-full">
              Erneut versuchen
            </Button>
            <StatusLink href="/" variant="secondary">Zum Dashboard</StatusLink>
          </div>
        </StatusPageFrame>
      </body>
    </html>
  )
}
