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
          <label htmlFor={textareaId} className="block text-[12.5px] font-medium text-[#98989d]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={cn(
            'w-full px-3 py-2.5 rounded-[8px] text-[13.5px]',
            // Apple-Textfeld: gefüllt statt umrandet, blauer Fokusring.
            'bg-[#2c2c2e] text-[#f5f5f7]',
            'placeholder:text-[#8e8e93]',
            'border border-transparent',
            'focus:outline-none focus:border-[#0a84ff] focus:shadow-[0_0_0_3px_rgba(10,132,255,0.3)]',
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
