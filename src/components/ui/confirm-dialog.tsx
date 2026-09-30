'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'

export type ConfirmOptions = {
  title: string
  description?: ReactNode
  /** Beschriftung des Bestätigungsknopfs. Sollte die Aktion benennen („Löschen“), nicht „OK“. */
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` färbt den Knopf rot – für alles, was sich nicht zurücknehmen lässt. */
  tone?: 'default' | 'danger'
  /**
   * Muss exakt eingetippt werden, bevor der Knopf freigegeben wird. Nur für
   * wirklich endgültige Löschungen – sonst nervt es mehr, als es schützt.
   */
  requireText?: string
}

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Ersatz für `window.confirm()`: gleicher Ablauf (`if (!(await confirm(…))) return`),
 * aber im Look des Dashboards, mit benannter Aktion und roter Warnung.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

type Pending = ConfirmOptions & { resolve: (value: boolean) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [typed, setTyped] = useState('')
  const pendingRef = useRef<Pending | null>(null)

  const confirm = useCallback<ConfirmFn>((input) => {
    const options = typeof input === 'string' ? { title: input } : input
    // Ein noch offener Dialog gilt als abgebrochen, statt ewig zu hängen.
    pendingRef.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve }
      pendingRef.current = next
      setTyped('')
      setPending(next)
    })
  }, [])

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value)
    pendingRef.current = null
    setPending(null)
  }, [])

  // Beim Unmount nichts offen lassen.
  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const danger = pending?.tone === 'danger'
  const locked = Boolean(pending?.requireText) && typed.trim() !== pending?.requireText

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={pending !== null} onClose={() => settle(false)} size="sm" ariaTitle={pending?.title}>
        {pending && (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!locked) settle(true)
            }}
          >
            <div className="flex items-start gap-3.5 pr-6">
              {danger && (
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-red-500/25 bg-red-500/10 text-red-300">
                  <AlertTriangle size={17} />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold leading-snug text-white">{pending.title}</h2>
                {pending.description && (
                  <div className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{pending.description}</div>
                )}
              </div>
            </div>

            {pending.requireText && (
              <div className="mt-4">
                <Input
                  label={`Zur Bestätigung „${pending.requireText}“ eingeben`}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => settle(false)}>
                {pending.cancelLabel ?? 'Abbrechen'}
              </Button>
              <Button
                type="submit"
                variant={danger ? 'danger' : 'primary'}
                disabled={locked}
                autoFocus={!pending.requireText}
              >
                {pending.confirmLabel ?? (danger ? 'Löschen' : 'Bestätigen')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </ConfirmContext.Provider>
  )
}
