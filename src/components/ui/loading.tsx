'use client'

import { cn } from '@/lib/utils'

export function Spinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-7 w-7' }
  const px = { sm: 14, md: 20, lg: 28 }[size]

  return (
      <span
          className={cn('loading-spinner relative block shrink-0 rounded-full text-[#d4d4d4]', sizes[size], className)}
          style={{ width: px, height: px }}
          aria-hidden
      />
  )
}

export function SkeletonBlock({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" className={cn('skeleton max-w-full rounded-[5px]', className)} style={style} />
}

/**
 * App-Start (Sitzung prüfen, Weiterleitungen): ein Skelett der ganzen
 * Oberfläche statt eines Ladekreisels – die App „steht“ sofort da.
 */
export function AppLoader() {
  return (
      <div className="flex min-h-screen bg-[#000000]" role="status" aria-busy="true" aria-label="Dashboard wird geladen">
        <div className="hidden w-[244px] shrink-0 border-r border-[#38383a]/70 bg-[#161617] px-3 pt-4 lg:block">
          <div className="mb-5 flex items-center gap-3 px-1">
            <SkeletonBlock className="h-10 w-10 rounded-full" />
            <div className="space-y-1.5">
              <SkeletonBlock className="h-3.5 w-16" />
              <SkeletonBlock className="h-3 w-24" />
            </div>
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: 11 }, (_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-2 py-[5px]">
                  <SkeletonBlock className="h-[26px] w-[26px] rounded-[7px]" />
                  <SkeletonBlock className="h-3.5" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 px-3 pt-16 sm:px-6 lg:px-8 lg:pt-6">
          <PageLoader withHeader />
        </div>
        <span className="sr-only">Lädt…</span>
      </div>
  )
}

/** Platzhalter für ein Dokument (Vertrag, Klage, Versetzungsantrag …). */
export function DocumentSkeleton() {
  return (
      <div role="status" aria-busy="true" aria-label="Dokument wird geladen" className="mx-auto w-full max-w-[820px] px-4 py-10">
        <div className="rounded-[14px] bg-[#1c1c1e] p-8 sm:p-12">
          <div className="flex items-center gap-4">
            <SkeletonBlock className="h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-3 w-32" />
            </div>
          </div>
          <SkeletonBlock className="mx-auto mt-10 h-6 w-2/3" />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 10 }, (_, i) => (
                <SkeletonBlock key={i} className="h-3.5" style={{ width: `${100 - ((i * 13) % 30)}%` }} />
            ))}
          </div>
          <div className="mt-12 grid grid-cols-2 gap-8">
            <SkeletonBlock className="h-10" />
            <SkeletonBlock className="h-10" />
          </div>
        </div>
        <span className="sr-only">Lädt…</span>
      </div>
  )
}

/**
 * Zeilen-Platzhalter für Listen innerhalb einer Karte – ersetzt Texte wie
 * „… werden geladen“. `compact` für schmale Spalten und Auswahllisten.
 */
export function ListSkeleton({ rows = 4, compact = false }: { rows?: number; compact?: boolean }) {
  return (
      <div role="status" aria-busy="true" aria-label="Wird geladen" className={cn('skeleton-enter space-y-3', compact ? 'py-2' : 'py-4')}>
        {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              {!compact && <SkeletonBlock className="h-8 w-8 shrink-0 rounded-[8px]" />}
              <div className="min-w-0 flex-1 space-y-1.5">
                <SkeletonBlock className="h-3.5" style={{ width: `${70 - (i % 3) * 15}%` }} />
                {!compact && <SkeletonBlock className="h-3" style={{ width: `${40 - (i % 2) * 12}%` }} />}
              </div>
            </div>
        ))}
        <span className="sr-only">Lädt…</span>
      </div>
  )
}

/**
 * Platzhalter in der Form einer typischen Seite, solange Daten laden. Vorher
 * stand hier ein großer, zentrierter Loader – die Seite sprang danach
 * komplett um. So bleibt das Layout stehen und füllt sich nur noch.
 *
 * `withHeader` zeichnet zusätzlich den Seitenkopf vor (für ganze Routen).
 */
export function PageLoader({ withHeader = false }: { withHeader?: boolean }) {
  return (
      <div role="status" aria-busy="true" aria-label="Inhalte werden geladen" className="skeleton-enter">
        {withHeader && (
            <div className="mb-5">
              <SkeletonBlock className="h-7 w-56" />
              <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
            </div>
        )}
        <div className="mb-5 flex flex-wrap gap-3">
          <SkeletonBlock className="h-9 min-w-0 flex-1 basis-48 rounded-[7px]" />
          <SkeletonBlock className="h-9 w-32 rounded-[9px]" />
        </div>
        <div className="border-y border-[#38383a]/60">
          <div className="divide-y divide-[#38383a]/40">
            {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 py-3.5">
                  <SkeletonBlock className="h-9 w-9 shrink-0 rounded-[10px]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <SkeletonBlock className="h-3.5" style={{ width: `${62 - (i % 3) * 14}%` }} />
                    <SkeletonBlock className="h-3" style={{ width: `${38 - (i % 2) * 10}%` }} />
                  </div>
                  <SkeletonBlock className="hidden h-6 w-20 rounded-full sm:block" />
                </div>
            ))}
          </div>
        </div>
        <span className="sr-only">Lädt…</span>
      </div>
  )
}

/** Entspricht dem kompakten Agentenprofil, damit die Stammdaten nicht springen. */
export function AgentProfileSkeleton() {
  return (
    <div className="skeleton-enter mx-auto w-full max-w-[1200px] min-w-0" role="status" aria-busy="true" aria-label="Agentenprofil wird geladen">
      <SkeletonBlock className="mb-4 h-3 w-32" />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonBlock className="h-7 w-44" />
          <SkeletonBlock className="h-3.5 w-64" />
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-[30px] w-24" />
          <SkeletonBlock className="h-[30px] w-24" />
        </div>
      </div>
      <div className="mb-4 flex gap-5 overflow-hidden border-b border-[#38383a]/70 py-3">
        {[40, 128, 144, 132, 80].map((width, index) => <SkeletonBlock key={index} className="h-3.5 shrink-0" style={{ width }} />)}
      </div>
      <div className="border-b border-[#38383a]/60 py-4">
        <SkeletonBlock className="mb-4 h-4 w-32" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className="space-y-2">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-4" style={{ width: `${38 + (index % 3) * 12}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 py-4">
        <SkeletonBlock className="h-4 w-52" />
        <SkeletonBlock className="h-3 w-36" />
      </div>
      <span className="sr-only">Lädt…</span>
    </div>
  )
}
