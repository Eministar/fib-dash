'use client'

import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Radix reserviert kein leeres value — wir mappen leere Auswahl intern. */
const EMPTY = '__fib_select_empty__'

function toInternal(v: string | undefined) {
  if (v === undefined || v === '') return EMPTY
  return v
}
function fromInternal(v: string) {
  if (v === EMPTY) return ''
  return v
}

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  label?: string
  error?: string
  options: SelectOption[]
  placeholder?: string
  value?: string
  defaultValue?: string
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onValueChange?: (value: string) => void
  disabled?: boolean
  className?: string
  id?: string
  name?: string
  size?: 'default' | 'sm'
  required?: boolean
}

const triggerBase = cn(
  'flex w-full min-w-0 items-center justify-between gap-2',
  'bg-[#181818] text-[#f4f4f4] border border-[#343434]/70',
  'focus:outline-none focus:border-[#d4d4d4] focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
  'data-[state=open]:border-[#d4d4d4]/60',
  'disabled:cursor-not-allowed disabled:opacity-40',
  'transition-all duration-150',
  'px-3 text-left',
  '[&_[data-placeholder]]:text-[#808080]',
  'aria-invalid:border-red-900'
)

const itemBase = cn(
  'relative flex cursor-pointer select-none items-center rounded-[7px] py-1.5 pl-2 pr-8',
  'text-[13.5px] text-[#f4f4f4] outline-none',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  'data-[highlighted]:bg-[#232323] data-[highlighted]:text-white',
  'data-[state=checked]:text-[#d4d4d4]'
)

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    className,
    label,
    error,
    id,
    options,
    placeholder,
    value,
    defaultValue,
    onChange,
    onValueChange,
    disabled,
    name,
    size = 'default',
    required,
  },
  ref
) {
  const genId = React.useId()
  const triggerId = id ?? genId

  const handleChange = (v: string) => {
    const out = fromInternal(v)
    onValueChange?.(out)
    onChange?.({ target: { value: out } } as React.ChangeEvent<HTMLSelectElement>)
  }

  const hasEmptyOption = options.some((o) => o.value === '')
  const rootValue = React.useMemo(() => {
    if (value === undefined) return undefined
    // Controlled empty selection: return '' (Radix's controlled "no value" state
    // that shows the placeholder) — NOT undefined, which would flip the Root to
    // uncontrolled and trigger React's controlled/uncontrolled warning.
    if (value === '' && !hasEmptyOption) return ''
    return toInternal(value)
  }, [value, hasEmptyOption])
  const rootDefault = defaultValue === undefined ? undefined : toInternal(defaultValue)

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {label && (
        <label htmlFor={triggerId} className="block text-[12.5px] font-medium text-[#aeaeae]">
          {label}
        </label>
      )}
      <SelectPrimitive.Root
        name={name}
        value={value !== undefined ? rootValue : undefined}
        defaultValue={value === undefined ? rootDefault : undefined}
        onValueChange={handleChange}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          id={triggerId}
          aria-required={required}
          className={cn(
            triggerBase,
            'cursor-pointer',
            size === 'default' && 'h-[36px] rounded-[9px] text-[13.5px]',
            size === 'sm' && 'h-[34px] rounded-[8px] text-[13px]',
            error && 'border-red-500/50'
          )}
        >
          <SelectPrimitive.Value
            placeholder={placeholder}
            className="flex-1 min-w-0 truncate text-left text-[#f4f4f4] data-[placeholder]:text-[#808080]"
          />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-3.5 w-3.5 text-[#a6a6a6] shrink-0 opacity-80" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className={cn(
              'z-[200] max-h-72 overflow-hidden rounded-[10px] min-w-[var(--radix-select-trigger-width)]',
              'glass-panel-elevated border border-[#404040]/90 shadow-[0_8px_32px_rgba(0,0,0,0.35)]',
            )}
          >
            <SelectPrimitive.Viewport className="p-1.5 max-h-72 overflow-y-auto">
              {options.map((opt) => {
                const internal = toInternal(opt.value)
                return (
                  <SelectPrimitive.Item key={internal} value={internal} className={itemBase}>
                    <span className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center text-[#d4d4d4]">
                      <SelectPrimitive.ItemIndicator>
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </SelectPrimitive.ItemIndicator>
                    </span>
                    <SelectPrimitive.ItemText className="block truncate pr-6 text-left">
                      {opt.label}
                    </SelectPrimitive.ItemText>
                  </SelectPrimitive.Item>
                )
              })}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error && <p className="text-[11.5px] text-red-500">{error}</p>}
    </div>
  )
})
Select.displayName = 'Select'
