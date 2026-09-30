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
      primary: 'bg-gradient-to-b from-accent to-[#b8b8b8] text-surface-sunken hover:from-accent-strong hover:to-[#c8c8c8] shadow-[0_1px_3px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]',
      secondary: 'bg-surface-raised text-fg hover:bg-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.12)]',
      danger: 'bg-gradient-to-b from-[#2a1620] to-[#231218] text-[#fca5a5] hover:from-[#341b27] hover:to-[#2a1620] shadow-[0_1px_2px_rgba(0,0,0,0.12)]',
      ghost: 'text-[#aeaeae] hover:text-white hover:bg-surface-raised/70',
      outline: 'border border-line-strong text-fg hover:bg-surface-raised/50 shadow-[0_1px_2px_rgba(0,0,0,0.08)]',
    }

    const sizes = {
      sm: 'h-[32px] px-3 text-[12.5px] rounded-[8px] gap-1.5',
      md: 'h-[36px] px-4 text-[13px] rounded-[9px] gap-2',
      lg: 'h-[40px] px-5 text-[13.5px] rounded-[10px] gap-2',
    }

    return (
      <button
        ref={ref}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        data-variant={variant}
        onClick={handleClick}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
          'disabled:opacity-35 disabled:pointer-events-none',
          'active:scale-[0.98]',
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
