'use client'

import { useId } from 'react'
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
  return <div className={cn('skeleton rounded-[8px]', className)} style={style} />
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
      <div role="status" aria-busy="true" aria-label="Wird geladen" className={cn('space-y-3', compact ? 'py-2' : 'py-4')}>
        {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.15 }}>
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
      <div role="status" aria-busy="true" aria-label="Inhalte werden geladen" className="animate-[fade-in_300ms_ease-out_120ms_both]">
        {withHeader && (
            <div className="mb-7">
              <SkeletonBlock className="h-7 w-56" />
              <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
              <div className="mt-5 h-px w-full bg-[#38383a]" />
            </div>
        )}
        <div className="mb-5 flex flex-wrap gap-3">
          <SkeletonBlock className="h-9 min-w-[240px] flex-1 rounded-[9px]" />
          <SkeletonBlock className="h-9 w-32 rounded-[9px]" />
        </div>
        <div className="rounded-[12px] bg-[#1c1c1e] p-5">
          <div className="space-y-4">
            {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.12 }}>
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

/** Cloud-Sync-Loader, adaptiert nach Uiverse.io / andrew-manzyk. */
export function PdCloudLoader({ className }: { className?: string }) {
  const instanceId = useId().replace(/:/g, '')
  const roundnessId = `pd-loader-roundness-${instanceId}`
  const shapesId = `pd-loader-shapes-${instanceId}`
  const clippingId = `pd-loader-clipping-${instanceId}`

  return (
    <span className={cn('pd-cloud-loader', className)} role="status" aria-label="Inhalte werden geladen">
      <span className="pd-cloud-loader__glow" aria-hidden />
      <svg
        className="pd-cloud-loader__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        aria-hidden
      >
        <defs>
          <filter id={roundnessId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
            <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" />
          </filter>
          <mask id={shapesId}>
            <g fill="white">
              <polygon points="50 37.5 80 75 20 75 50 37.5" />
              <circle cx="20" cy="60" r="15" />
              <circle cx="80" cy="60" r="15" />
              <g className="pd-cloud-loader__bubbles">
                <circle cx="20" cy="60" r="15" />
                <circle cx="20" cy="60" r="15" />
                <circle cx="20" cy="60" r="15" />
              </g>
            </g>
          </mask>
          <mask id={clippingId} clipPathUnits="userSpaceOnUse">
            <g className="pd-cloud-loader__lines" filter={`url(#${roundnessId})`}>
              <g mask={`url(#${shapesId})`} stroke="white">
                {Array.from({ length: 21 }, (_, index) => {
                  const y = -40 + index * 9
                  return <line key={y} x1="-50" y1={y} x2="150" y2={y} />
                })}
              </g>
            </g>
          </mask>
        </defs>
        <rect className="pd-cloud-loader__cloud" width="100" height="100" mask={`url(#${clippingId})`} />
        <g className="pd-cloud-loader__arrows">
          <path d="M33.52,68.12 C35.02,62.8 39.03,58.52 44.24,56.69 C49.26,54.93 54.68,55.61 59.04,58.4 L56.24,60.53 C55.45,61.13 55.68,62.37 56.63,62.64 L67.21,65.66 C67.98,65.88 68.75,65.3 68.74,64.5 L68.68,53.5 C68.67,52.51 67.54,51.95 66.75,52.55 L64.04,54.61 C57.88,49.79 49.73,48.4 42.25,51.03 C35.2,53.51 29.78,59.29 27.74,66.49 C27.29,68.08 28.22,69.74 29.81,70.19 C30.09,70.27 30.36,70.31 30.63,70.31 C31.94,70.31 33.14,69.44 33.52,68.12Z" />
          <path d="M69.95,74.85 C68.35,74.4 66.7,75.32 66.25,76.92 C64.74,82.24 60.73,86.51 55.52,88.35 C50.51,90.11 45.09,89.43 40.73,86.63 L43.53,84.51 C44.31,83.91 44.08,82.67 43.13,82.4 L32.55,79.38 C31.78,79.16 31.02,79.74 31.02,80.54 L31.09,91.54 C31.09,92.53 32.22,93.09 33.01,92.49 L35.72,90.43 C39.81,93.63 44.77,95.32 49.84,95.32 C52.41,95.32 55,94.89 57.51,94.01 C64.56,91.53 69.99,85.75 72.02,78.55 C72.47,76.95 71.54,75.3 69.95,74.85Z" />
        </g>
      </svg>
    </span>
  )
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
      <div className="space-y-2" role="status" aria-busy="true" aria-label="Tabelle wird geladen">
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-3">
              {Array.from({ length: cols }).map((_, j) => (
                  <SkeletonBlock key={j} className="h-9 flex-1" />
              ))}
            </div>
        ))}
      </div>
  )
}
