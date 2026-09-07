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

export function PageLoader() {
  return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-5 text-[#909090]">
        <PdCloudLoader />
        <div className="flex flex-col items-center gap-1.5">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-[#a6a6a6] uppercase">Lädt</p>
          <p className="text-[11px] text-[#808080]">Einen Moment bitte…</p>
        </div>
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
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse" style={{ animationDelay: `${i * 75}ms` }}>
              {Array.from({ length: cols }).map((_, j) => (
                  <div key={j} className="h-9 bg-gradient-to-r from-[#1f1f1f]/60 to-[#232323]/40 rounded-[8px] flex-1" />
              ))}
            </div>
        ))}
      </div>
  )
}
