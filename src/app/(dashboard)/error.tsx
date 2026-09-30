'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { isChunkLoadProblem, reloadOnce } from '@/components/runtime/chunk-load-guard'

/**
 * Fehlergrenze für den Dashboard-Bereich. Sitzt innerhalb des Layouts:
 * Seitenleiste und Suche bleiben stehen, nur der kaputte Inhalt wird
 * ersetzt – vorher fiel die ganze App auf die globale Fehlerseite.
 */
export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    if (isChunkLoadProblem(error)) {
      if (reloadOnce('ChunkLoadError im Dashboard-Bereich erkannt — automatischer Reload nach Deploy.')) return
    }

    console.error(error)
    fetch('/api/runtime-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Dashboard-Fehler',
        message: error?.message,
        digest: error?.digest,
        path: window.location.pathname,
        stack: error?.stack,
      }),
      keepalive: true,
    }).catch(() => {})
  }, [error])

  return (
    <div className="mx-auto max-w-xl pt-10">
      <Card className="px-6 py-10 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-red-500/25 bg-red-500/10 text-red-300">
          <AlertTriangle size={22} strokeWidth={1.75} />
        </span>
        <h1 className="text-[17px] font-semibold text-white">Diese Ansicht konnte nicht geladen werden</h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[#a6a6a6]">
          {process.env.NODE_ENV === 'development' && error?.message
            ? error.message
            : 'Der Fehler wurde automatisch gemeldet. Versuch es erneut – der Rest des Dashboards funktioniert weiter.'}
        </p>
        {error?.digest && <p className="mt-2 font-mono text-[11px] text-[#8c8c8c]">Fehler-ID: {error.digest}</p>}
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Link href="/dashboard">
            <Button variant="ghost" className="w-full">Zum Dashboard</Button>
          </Link>
          <Button onClick={() => unstable_retry()}>
            <RefreshCw size={14} />
            Erneut versuchen
          </Button>
        </div>
      </Card>
    </div>
  )
}
