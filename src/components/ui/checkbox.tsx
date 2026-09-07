'use client'

import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onCheckedChange, label, disabled, className }: CheckboxProps) {
  return (
    <label className={cn('flex items-center gap-2.5 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed', className)}>
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        disabled={disabled}
        className={cn(
          'h-[18px] w-[18px] rounded-[5px] border transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4d4d4]/40',
          checked
            ? 'bg-gradient-to-b from-[#d4d4d4] to-[#b8b8b8] border-[#b8b8b8] text-[#181818] shadow-[0_1px_2px_rgba(212,212,212,0.2)]'
            : 'border-[#464646] bg-[#181818]/60'
        )}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Check size={12} strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <span className="text-[13px] text-[#c3c3c3]">{label}</span>}
    </label>
  )
}
