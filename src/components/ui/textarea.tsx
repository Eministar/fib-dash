'use client'

import { forwardRef, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-[12.5px] font-medium text-[#aeaeae]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={id}
          className={cn(
            'w-full px-3 py-2.5 rounded-[9px] text-[13.5px]',
            'bg-[#181818]/60 text-[#f4f4f4]',
            'placeholder:text-[#808080]',
            'border border-[#343434]/70',
            'focus:outline-none focus:border-[#d4d4d4] focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
            'transition-all duration-150 resize-none',
            error && 'border-red-300',
            className
          )}
          {...props}
        />
        {error && <p className="text-[11.5px] text-red-500">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
