'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { useConfirm } from '@/components/ui/confirm-dialog'

/**
 * Schützt ungespeicherte Eingaben vor dem versehentlichen Verlassen der Seite.
 *
 * - Tab schließen / neu laden: die Browser-Warnung (`beforeunload`).
 * - Klick auf einen internen Link (Seitenleiste, Breadcrumbs …): der eigene
 *   Bestätigungsdialog. Der App Router kann Navigation nicht blockieren,
 *   deshalb fangen wir den Klick in der Capture-Phase ab, bevor `<Link>` ihn sieht.
 */
export function useUnsavedChanges(dirty: boolean, message = 'Deine Änderungen gehen verloren, wenn du die Seite jetzt verlässt.') {
  const confirm = useConfirm()
  const router = useRouter()
  const dirtyRef = useRef(dirty)

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  useEffect(() => {
    if (!dirty) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Ältere Browser zeigen die Warnung nur mit gesetztem returnValue.
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Sprung innerhalb derselben Seite (#anker) verliert nichts.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      event.preventDefault()
      event.stopPropagation()
      void confirm({
        title: 'Ungespeicherte Änderungen verwerfen?',
        description: message,
        confirmLabel: 'Verwerfen',
        cancelLabel: 'Weiter bearbeiten',
        tone: 'danger',
      }).then((leave) => {
        if (!leave) return
        dirtyRef.current = false
        router.push(url.pathname + url.search + url.hash)
      })
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [confirm, dirty, message, router])
}
