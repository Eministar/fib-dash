'use client'

import * as React from 'react'
import * as Popover from '@radix-ui/react-popover'
import { type Locale, format, parse, isValid } from 'date-fns'
import { de } from 'date-fns/locale'
import { DayPicker } from 'react-day-picker'
import { Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import 'react-day-picker/style.css'

export interface DateFieldProps {
  label?: string
  error?: string
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  className?: string
  /** Label im Trigger, wenn kein valides Datum gesetzt (z. B. nach Löschen) */
  emptyLabel?: string
  locale?: Locale
  /** Wenn false, kein Löschen-Button (z. B. Pflichtfeld) */
  allowClear?: boolean
}

const parseIsoDate = (s: string): Date | undefined => {
  if (!s || !s.trim()) return undefined
  const d = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(d) ? d : undefined
}

export function DateField({
  label,
  error,
  id,
  value,
  onChange,
  disabled,
  required,
  className,
  emptyLabel = 'Datum wählen',
  locale = de,
  allowClear = true,
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false)
  const genId = React.useId()
  const fieldId = id ?? genId
  const errorId = error ? `${fieldId}-error` : undefined
  const selected = parseIsoDate(value)
  const display =
    selected != null
      ? format(selected, 'dd.MM.yyyy', { locale })
      : emptyLabel

  const applyDate = (d: Date) => {
    onChange(format(d, 'yyyy-MM-dd'))
    setOpen(false)
  }

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      {label && (
        <label htmlFor={fieldId} className="block text-[12.5px] font-medium text-[#aeaeae]">
          {label}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            id={fieldId}
            disabled={disabled}
            aria-describedby={errorId}
            data-invalid={error ? '' : undefined}
            data-required={required ? '' : undefined}
            className={cn(
              'flex w-full h-[36px] items-center justify-between gap-2 rounded-[9px] border px-3 text-left text-[13.5px] transition-all duration-150',
              'bg-[#181818]/60 text-[#f4f4f4] border border-[#343434]/70',
              'focus:outline-none focus:border-[#d4d4d4] focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
              'disabled:cursor-not-allowed disabled:opacity-40',
              'hover:border-[#404040]',
              !selected && 'text-[#808080]',
              error && 'border-red-500/50'
            )}
          >
            <span className="min-w-0 flex-1 truncate">{display}</span>
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-[#a6a6a6] opacity-90" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align="start"
            className={cn(
              'z-[200] w-auto min-w-[280px] rounded-[12px] p-0 outline-none',
              'glass-panel-elevated border border-[#404040]/90 shadow-[0_8px_32px_rgba(0,0,0,0.35)]'
            )}
          >
            <div
              className="fib-rdp p-2 text-[#f4f4f4] [&_.rdp-weekday]:text-[#909090] [&_.rdp-outside]:text-[#808080] [&_.rdp-today]:text-[#d4d4d4] [&_button.rdp-day_button]:text-[#f4f4f4] [&_button.rdp-day_button:hover]:bg-[#232323]"
              style={
                {
                  ['--rdp-accent-color' as string]: '#d4d4d4',
                  ['--rdp-accent-background-color' as string]: 'rgba(212,212,212, 0.2)',
                } as React.CSSProperties
              }
            >
              <DayPicker
                mode="single"
                required={false}
                selected={selected}
                onSelect={(d) => d && applyDate(d)}
                defaultMonth={selected ?? new Date()}
                weekStartsOn={1}
                locale={locale}
                classNames={{
                  root: 'w-full',
                  months: 'relative',
                  // Liegt unter der Nav-Toolbar; Caption nur Text — keine Klicks abfangen
                  month_caption: 'flex h-9 items-center justify-center text-[13px] font-semibold text-white mb-1 pointer-events-none',
                  caption_label: 'capitalize',
                  // In v9 sitzt die Monats-Navigation in diesem <nav> (nicht in der Caption-Zeile);
                  // ohne z-index liegt der darunterliegende Monats-Block oben drüber und fängt alle Klicks ab
                  nav: 'absolute top-0 left-0 right-0 z-20 flex w-full items-center justify-between px-0.5 pointer-events-auto',
                  button_previous:
                    'relative z-20 h-7 w-7 inline-flex items-center justify-center rounded-lg text-[#a6a6a6] hover:bg-[#232323] hover:text-[#d4d4d4]',
                  button_next:
                    'relative z-20 h-7 w-7 inline-flex items-center justify-center rounded-lg text-[#a6a6a6] hover:bg-[#232323] hover:text-[#d4d4d4]',
                  month: 'relative z-0 space-y-2 p-0.5',
                  weekdays: 'flex',
                  weekday: 'w-9 text-[10px] font-medium uppercase',
                  week: 'mt-0.5 flex w-full',
                  day: 'h-9 w-9 p-0 text-center text-[12px] text-[#f4f4f4]',
                  day_button:
                    'h-8 w-8 rounded-lg mx-auto text-[#f4f4f4] hover:bg-[#232323] focus:outline-none focus:ring-2 focus:ring-[#d4d4d4]/30',
                  selected:
                    'bg-gradient-to-b from-[#d4d4d4] to-[#b8b8b8] text-[#181818] font-semibold !opacity-100',
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-[#343434]/50 px-2 py-1.5">
              {allowClear ? (
                <button
                  type="button"
                  className="text-[12px] text-[#a6a6a6] hover:text-[#d4d4d4] px-1.5 py-0.5 rounded"
                  onClick={() => {
                    onChange('')
                    setOpen(false)
                  }}
                  disabled={disabled}
                >
                  Löschen
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className="text-[12px] text-[#d4d4d4] hover:text-white px-1.5 py-0.5 rounded"
                onClick={() => applyDate(new Date())}
                disabled={disabled}
              >
                Heute
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p id={errorId} className="text-[11.5px] text-red-500">{error}</p>}
    </div>
  )
}
