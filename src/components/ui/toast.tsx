'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  /** Ein Knopf im Toast, z. B. „Rückgängig“. Ein Klick schließt den Toast. */
  action?: ToastAction
  /** Überschreibt die Standarddauer (ms). */
  duration?: number
}

interface ToastContextType {
  /** Gibt die ID zurück, damit der Aufrufer den Toast vorzeitig schließen kann. */
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const icons = { success: CheckCircle, error: XCircle, warning: AlertCircle, info: Info }

/** Fehler und Warnungen bleiben länger stehen – die will man zu Ende lesen. */
const durations: Record<ToastType, number> = { success: 3500, info: 4000, warning: 6000, error: 7000 }

const typeColors = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-[#d4d4d4]',
  info: 'text-blue-400',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    const duration = toast.duration ?? durations[toast.type]
    setToasts((prev) => [...prev, { ...toast, id, duration }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
    return id
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 left-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:bottom-5 sm:right-5"
        aria-live="polite"
        aria-relevant="additions"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((toast) => {
            const Icon = icons[toast.type]
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.2 }}
                role={toast.type === 'error' ? 'alert' : 'status'}
                className="glass-panel-elevated relative overflow-hidden rounded-[12px] flex w-full items-start gap-2.5 px-4 py-3 sm:w-[340px]"
              >
                <Icon size={16} className={`mt-0.5 shrink-0 ${typeColors[toast.type]}`} strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-white">{toast.title}</p>
                  {toast.message && <p className="text-[11.5px] text-[#a6a6a6] mt-0.5 leading-relaxed break-words">{toast.message}</p>}
                </div>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick()
                      removeToast(toast.id)
                    }}
                    className="-my-1 shrink-0 self-center rounded-[7px] border border-[#404040] px-2.5 py-1 text-[12px] font-semibold text-[#f4f4f4] transition-colors hover:border-[#5a5a5a] hover:bg-[#2a2a2a]"
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  aria-label="Meldung schließen"
                  className="-mr-1.5 -mt-0.5 shrink-0 rounded-[6px] p-1 text-[#909090] transition-colors hover:bg-[#232323]/70 hover:text-[#d4d4d4]"
                >
                  <X size={13} />
                </button>
                {toast.action && (
                  // Zeigt, wie lange die Aktion noch möglich ist.
                  <span
                    aria-hidden
                    className="toast-countdown absolute bottom-0 left-0 h-[2px] w-full origin-left bg-[#d4d4d4]/40"
                    style={{ animationDuration: `${toast.duration}ms` }}
                  />
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
