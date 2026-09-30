'use client'

import { forwardRef, useId, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const generatedId = useId()
    const textareaId = id ?? (label || error ? generatedId : undefined)
    const errorId = error && textareaId ? `${textareaId}-error` : undefined
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={textareaId} className="block text-[12.5px] font-medium text-[#aeaeae]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            'w-full px-3 py-2.5 rounded-[9px] text-[13.5px]',
            'bg-surface-sunken/60 text-fg',
            'placeholder:text-fg-subtle',
            'border border-line/70',
            'focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
            'transition-all duration-150 resize-none',
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
Textarea.displayName = 'Textarea'

export { Textarea }
