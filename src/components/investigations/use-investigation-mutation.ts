'use client'

import { useCallback } from 'react'

import { useApi } from '@/hooks/use-api'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'

interface MutateOptions {
  method?: 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Erfolgsmeldung. Ohne Titel wird nichts angezeigt. */
  successTitle?: string
  successMessage?: string
  errorTitle?: string
}

/**
 * Ein Schreibvorgang der Ermittlungs-Panels: absenden, melden, neu laden.
 * Liefert `true` bei Erfolg, damit der Aufrufer sein Formular schliessen kann,
 * ohne selbst try/catch zu schreiben.
 */
export function useInvestigationMutation(onChanged?: () => void | Promise<void>) {
  const { execute, loading } = useApi()
  const { toastSuccess, toastError } = useInvestigationToast()

  const mutate = useCallback(
    async (url: string, options: MutateOptions = {}) => {
      const { method = 'POST', body, successTitle, successMessage, errorTitle } = options

      try {
        await execute(url, {
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        if (successTitle) toastSuccess(successTitle, successMessage)
        await onChanged?.()
        return true
      } catch (cause) {
        toastError(
          errorTitle ?? 'Aktion fehlgeschlagen',
          cause instanceof Error ? cause.message : 'Unbekannter Fehler',
        )
        return false
      }
    },
    [execute, onChanged, toastSuccess, toastError],
  )

  return { mutate, saving: loading }
}
