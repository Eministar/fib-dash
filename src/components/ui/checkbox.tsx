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
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0a84ff]/50',
          checked
            ? 'bg-[#0a84ff] border-[#0a84ff] text-white'
            : 'border-[#636366] bg-[#2c2c2e]'
        )}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Check size={12} strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label && <span className="text-[13px] text-[#c7c7cc]">{label}</span>}
    </label>
  )
}
