'use client'

import { forwardRef, useId, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  /** Zeigt und akzeptiert ausschließlich Ziffern (auch bei Copy & Paste). */
  numericOnly?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, numericOnly = false, onChange, value, defaultValue, inputMode, pattern, type, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? (label || error ? generatedId : undefined)
    const errorId = error && inputId ? `${inputId}-error` : undefined
    const visibleValue = numericOnly && typeof value === 'string' ? value.replace(/\D/g, '') : value
    const visibleDefaultValue = numericOnly && typeof defaultValue === 'string' ? defaultValue.replace(/\D/g, '') : defaultValue

    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
      if (numericOnly) event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '')
      onChange?.(event)
    }

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-[12.5px] font-medium text-[#aeaeae]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          type={numericOnly ? 'text' : type}
          inputMode={numericOnly ? 'numeric' : inputMode}
          pattern={numericOnly ? '[0-9]*' : pattern}
          value={visibleValue}
          defaultValue={visibleDefaultValue}
          onChange={handleChange}
          className={cn(
            'w-full h-[36px] px-3 rounded-[9px] text-[13.5px]',
            'bg-surface-sunken/60 text-fg',
            'placeholder:text-fg-subtle',
            'border border-line/70',
            'focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
            'transition-all duration-150',
            error && 'border-red-500/50 focus:border-red-400/70 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]',
            className
          )}
          {...props}
        />
        {error && <p id={errorId} className="text-[11.5px] text-red-400">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
