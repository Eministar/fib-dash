'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { useAuth } from '@/context/auth-context'
import { startPageAction } from '@/hooks/use-page-action'
import { isPlainShortcut, newActionForPath } from '@/lib/palette-actions'

function isTyping() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** „N“ legt auf Listen mit Anlage-Dialog (Akten, Personen, Fahrzeuge) einen neuen Eintrag an. */
export function useNewShortcut() {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const action = newActionForPath(user, pathname)
    if (!action) return
    const onKey = (event: KeyboardEvent) => {
      if (!isPlainShortcut(event, 'n') || isTyping()) return
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      startPageAction(action.path, action.action, router.push)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [user, pathname, router])
}
