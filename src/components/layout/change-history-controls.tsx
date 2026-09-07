'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { notifyLiveUpdate } from '@/lib/live-updates'
import { useToast } from '@/components/ui/toast'

interface HistoryAction {
  id: string
  label: string
  createdAt: string
  hasExternalSideEffects: boolean
}

interface HistoryStatus {
  undo: HistoryAction | null
  redo: HistoryAction | null
}

const HISTORY_EVENT = 'fib:change-history'
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isHistoryRequest(pathname: string): boolean {
  return pathname.startsWith('/api/change-history')
}

function isTrackableRequest(input: RequestInfo | URL, init?: RequestInit): {
  track: boolean
  method: string
  url: URL | null
} {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const rawUrl = request?.url ?? String(input)
  let url: URL
  try {
    url = new URL(rawUrl, window.location.origin)
  } catch {
    return { track: false, method, url: null }
  }

  const sameOrigin = url.origin === window.location.origin
  const isApi = url.pathname.startsWith('/api/')
  const excluded = isHistoryRequest(url.pathname) || url.pathname.startsWith('/api/auth/')
  return { track: sameOrigin && isApi && MUTATION_METHODS.has(method) && !excluded, method, url }
}

function editableTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : document.activeElement as HTMLElement | null
  if (!element) return false
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

function newChangeSetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `change_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

async function responseData<T>(response: Response): Promise<T> {
  const payload = await response.json() as { success?: boolean; data?: T; error?: string }
  if (!response.ok || !payload.success) throw new Error(payload.error || 'Änderungshistorie nicht verfügbar')
  return payload.data as T
}

export function ChangeHistoryControls() {
  const { addToast } = useToast()
  const [status, setStatus] = useState<HistoryStatus>({ undo: null, redo: null })
  const [busy, setBusy] = useState<'undo' | 'redo' | null>(null)
  const busyRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/change-history', { cache: 'no-store', credentials: 'include' })
      setStatus(await responseData<HistoryStatus>(response))
    } catch {
      setStatus({ undo: null, redo: null })
    }
  }, [])

  useEffect(() => {
    const originalFetch = window.fetch.bind(window)

    const trackedFetch: typeof window.fetch = async (input, init) => {
      const requestInfo = isTrackableRequest(input, init)
      if (!requestInfo.track || !requestInfo.url) return originalFetch(input, init)

      const changeSetId = newChangeSetId()
      const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
      const headers = new Headers(init?.headers ?? request?.headers)
      headers.set('X-Change-Set-Id', changeSetId)
      headers.set('X-Change-Method', requestInfo.method)
      headers.set('X-Change-Path', `${requestInfo.url.pathname}${requestInfo.url.search}`)

      let response: Response
      try {
        response = await originalFetch(input, { ...init, headers })
      } catch (error) {
        void originalFetch(`/api/change-history/${changeSetId}`, { method: 'DELETE', credentials: 'include' })
        throw error
      }

      if (response.ok) {
        try {
          const commit = await originalFetch(`/api/change-history/${changeSetId}/commit`, {
            method: 'POST',
            credentials: 'include',
          })
          const result = await responseData<{ recorded: boolean }>(commit)
          if (result.recorded) window.dispatchEvent(new Event(HISTORY_EVENT))
        } catch (error) {
          addToast({
            type: 'warning',
            title: 'Änderung gespeichert, aber nicht rückgängig machbar',
            message: error instanceof Error ? error.message : undefined,
          })
        }
      } else {
        void originalFetch(`/api/change-history/${changeSetId}`, { method: 'DELETE', credentials: 'include' })
      }

      return response
    }

    window.fetch = trackedFetch
    const onHistoryChange = () => void refresh()
    window.addEventListener(HISTORY_EVENT, onHistoryChange)
    void refresh()

    return () => {
      if (window.fetch === trackedFetch) window.fetch = originalFetch
      window.removeEventListener(HISTORY_EVENT, onHistoryChange)
    }
  }, [addToast, refresh])

  const apply = useCallback(async (direction: 'undo' | 'redo') => {
    if (busyRef.current || !status[direction]) return
    busyRef.current = true
    setBusy(direction)
    try {
      const response = await fetch(`/api/change-history/${direction}`, {
        method: 'POST',
        credentials: 'include',
      })
      const action = await responseData<HistoryAction>(response)
      notifyLiveUpdate()
      window.dispatchEvent(new Event(HISTORY_EVENT))
      addToast({
        type: 'success',
        title: direction === 'undo' ? 'Änderung rückgängig gemacht' : 'Änderung wiederholt',
        message: action.hasExternalSideEffects
          ? `${action.label}. Bereits versendete externe Nachrichten bleiben bestehen.`
          : action.label,
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: direction === 'undo' ? 'Rückgängig nicht möglich' : 'Wiederholen nicht möglich',
        message: error instanceof Error ? error.message : undefined,
      })
    } finally {
      busyRef.current = false
      setBusy(null)
      await refresh()
    }
  }, [addToast, refresh, status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || editableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = (key === 'z' && event.shiftKey) || (key === 'y' && !event.metaKey)
      if (!wantsUndo && !wantsRedo) return
      event.preventDefault()
      void apply(wantsUndo ? 'undo' : 'redo')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [apply])

  return (
    <div className="fixed right-3 top-1.5 z-50 inline-grid grid-cols-2 items-center gap-1 rounded-[9px] border border-[#d4d4d4]/15 bg-[#181818]/95 p-1 shadow-[0_6px_20px_rgba(0,0,0,0.22)] backdrop-blur-xl lg:bottom-[58px] lg:left-[10px] lg:right-auto lg:top-auto lg:w-[224px]">
      <HistoryButton
        label="Rückgängig"
        shortcut="Strg/Cmd+Z"
        action={status.undo}
        disabled={!status.undo || busy !== null}
        loading={busy === 'undo'}
        onClick={() => void apply('undo')}
      >
        <Undo2 size={15} />
      </HistoryButton>
      <HistoryButton
        label="Wiederholen"
        shortcut="Strg+Y / Cmd+Shift+Z"
        action={status.redo}
        disabled={!status.redo || busy !== null}
        loading={busy === 'redo'}
        onClick={() => void apply('redo')}
      >
        <Redo2 size={15} />
      </HistoryButton>
    </div>
  )
}

function HistoryButton({
  label,
  shortcut,
  action,
  disabled,
  loading,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  action: HistoryAction | null
  disabled: boolean
  loading: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const title = action
    ? `${label}: ${action.label} (${shortcut})${action.hasExternalSideEffects ? ' · Externe Nebenwirkungen bleiben bestehen' : ''}`
    : `${label} (${shortcut})`
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      title={title}
      className={cn(
        'inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 text-[12px] font-medium text-[#c3c3c3] transition-colors',
        'hover:bg-[#333333] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40',
        'disabled:cursor-not-allowed disabled:opacity-30',
        loading && 'animate-pulse',
      )}
    >
      {children}
      <span className="hidden max-w-[72px] truncate lg:inline">{action?.label ?? label}</span>
    </button>
  )
}
