'use client'

import { useEffect } from 'react'

const RELOAD_KEY = 'fib:last-chunk-reload'
const RELOAD_WINDOW_MS = 30_000

export function isChunkLoadProblem(value: unknown) {
  if (!value) return false
  const text =
    value instanceof Error
      ? `${value.name} ${value.message} ${value.stack ?? ''}`
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)

  return /ChunkLoadError|Loading chunk|Failed to load chunk|\/_next\/static\/chunks\//i.test(text)
}

export function reloadOnce(reason: string) {
  if (typeof window === 'undefined') return false
  const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || '0')
  if (Date.now() - lastReload < RELOAD_WINDOW_MS) return false

  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  fetch('/api/runtime-events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Chunk neu geladen',
      message: reason,
      path: window.location.pathname,
    }),
    keepalive: true,
  }).catch(() => {})

  window.location.reload()
  return true
}

export function ChunkLoadGuard() {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadProblem(event.reason)) {
        event.preventDefault()
        reloadOnce('Ein alter Next.js Chunk konnte nach einem neuen Build nicht geladen werden.')
      }
    }

    const onError = (event: ErrorEvent) => {
      if (isChunkLoadProblem(event.error) || isChunkLoadProblem(event.message)) {
        reloadOnce('Ein Script-Chunk konnte nicht geladen werden.')
      }
    }

    const onResourceError = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const src =
        (target as HTMLScriptElement).src ||
        (target as HTMLLinkElement).href ||
        ''
      if (typeof src === 'string' && /\/_next\/static\/(chunks|css)\//.test(src)) {
        reloadOnce(`Statischer Build-Asset konnte nicht geladen werden: ${src}`)
      }
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection)
    window.addEventListener('error', onError)
    window.addEventListener('error', onResourceError, true)

    return () => {
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
      window.removeEventListener('error', onError)
      window.removeEventListener('error', onResourceError, true)
    }
  }, [])

  return null
}
