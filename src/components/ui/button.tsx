'use client'

import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/loading'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, onClick, ...props }, ref) => {
    // Gibt onClick ein Promise zurück (async-Handler), bleibt der Knopf bis zum
    // Ende gesperrt und zeigt den Spinner. Verhindert doppelt angelegte
    // Einträge durch Doppelklick – ohne dass jede Stelle `loading` pflegen muss.
    const [pending, setPending] = useState(false)
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => { mounted.current = false }
    }, [])

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (pending) {
        event.preventDefault()
        return
      }
      const result = onClick?.(event) as unknown
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        setPending(true)
        ;(result as Promise<unknown>)
          .catch(() => { /* Fehler behandelt der Aufrufer (Toast); hier nur entsperren. */ })
          .finally(() => { if (mounted.current) setPending(false) })
      }
    }
    const busy = Boolean(loading) || pending

    const variants = {
      // Flach wie macOS: eine Farbe, kein Verlauf, kein Glanz.
      primary: 'bg-[#0a84ff] text-white hover:bg-[#1a8cff] active:bg-[#0070e0]',
      secondary: 'bg-[#3a3a3c] text-[#f5f5f7] hover:bg-[#48484a] active:bg-[#2c2c2e]',
      danger: 'bg-[#ff453a]/15 text-[#ff6961] hover:bg-[#ff453a]/25 active:bg-[#ff453a]/30',
      ghost: 'text-[#98989d] hover:text-[#f5f5f7] hover:bg-[#2c2c2e] active:bg-[#3a3a3c]',
      outline: 'border border-[#48484a] text-[#f5f5f7] hover:bg-[#2c2c2e] active:bg-[#3a3a3c]',
    }

    const sizes = {
      sm: 'h-[30px] px-3 text-[12.5px] rounded-[7px] gap-1.5',
      md: 'h-[34px] px-4 text-[13px] rounded-[8px] gap-2',
      lg: 'h-[40px] px-5 text-[14px] rounded-[10px] gap-2',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        data-variant={variant}
        onClick={handleClick}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors duration-100',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0a84ff]/50',
          'disabled:opacity-40 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {busy && <Spinner size="sm" className="text-current" />}
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
