'use client'

import { useMemo } from 'react'

import { useToast } from '@/components/ui/toast'

/**
 * Dünne Hülle um `addToast`. Die Ermittlungs-Ansichten melden fast immer nur
 * Erfolg oder Fehler – das spart die wiederholte Objektschreibweise.
 */
export function useInvestigationToast() {
  const { addToast } = useToast()

  return useMemo(
    () => ({
      toastSuccess: (title: string, message?: string) => addToast({ type: 'success', title, message }),
      toastError: (title: string, message?: string) => addToast({ type: 'error', title, message }),
    }),
    [addToast],
  )
}
