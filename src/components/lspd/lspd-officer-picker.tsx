'use client'

import { useId, useState } from 'react'
import { Search, ShieldUser, X } from 'lucide-react'

import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useFetch } from '@/hooks/use-fetch'
import { lspdOfficerName, lspdStatusLabel, type LspdOfficer } from '@/lib/lspd-officers'
import { cn } from '@/lib/utils'

/**
 * Auswahl eines LSPD-Beamten aus dem lspd-hr-Panel. Überall dort einsetzen, wo
 * in fib-dash ein LSPD-Beamter gewählt wird, statt Namen von Hand einzutippen.
 */
export function LspdOfficerPicker({
  value,
  onChange,
  label = 'LSPD-Beamter',
  disabled,
}: {
  value: LspdOfficer | null
  onChange: (officer: LspdOfficer | null) => void
  label?: string
  disabled?: boolean
}) {
  const inputId = useId()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebouncedValue(term.trim(), 250)
  const { data, loading, error } = useFetch<LspdOfficer[]>(
    open && !value ? `/api/lspd/officers?limit=20&q=${encodeURIComponent(debounced)}` : null,
  )
  const officers = data ?? []

  if (value) {
    return (
      <div>
        <p className="mb-1.5 text-[12.5px] font-medium text-[#c7c7cc]">{label}</p>
        <div className="flex items-center gap-3 rounded-[9px] border border-[#38383a] bg-[#1c1c1e]/60 px-3 py-2">
          <ShieldUser className="h-4 w-4 shrink-0 text-[#64d2ff]" />
          <OfficerLine officer={value} />
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ml-auto shrink-0 text-[#8e8e93] hover:text-white"
              aria-label="Auswahl entfernen"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1.5 block text-[12.5px] font-medium text-[#c7c7cc]">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e93]" />
        <input
          id={inputId}
          value={term}
          disabled={disabled}
          onChange={(event) => {
            setTerm(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Name oder Dienstnummer im LSPD-Panel suchen …"
          className="h-[36px] w-full rounded-[9px] border border-[#38383a]/70 bg-[#1c1c1e]/60 pl-9 pr-3 text-[13.5px] text-[#f5f5f7] placeholder:text-[#8e8e93] focus:border-[#d4d4d4] focus:outline-none disabled:opacity-40"
        />
      </div>
      {open && (
        <div className="glass-panel-elevated absolute z-30 mt-1 max-h-[300px] w-full overflow-y-auto rounded-[10px] border border-[#48484a] py-1">
          {error ? (
            <p role="alert" className="px-3 py-3 text-[12.5px] text-[#fca5a5]">{error}</p>
          ) : loading && officers.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-[#8e8e93]">Wird gesucht …</p>
          ) : officers.length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-[#8e8e93]">Kein Beamter gefunden.</p>
          ) : (
            <ul>
              {officers.map((officer) => (
                <li key={officer.id}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      onChange(officer)
                      setTerm('')
                      setOpen(false)
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#2c2c2e]"
                  >
                    <OfficerLine officer={officer} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function OfficerLine({ officer }: { officer: LspdOfficer }) {
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-x-2">
        <span className="font-mono text-[11.5px] text-[#d4d4d4]">{officer.badgeNumber}</span>
        <span className="truncate text-[13.5px] font-medium text-white">{lspdOfficerName(officer)}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[11.5px] text-[#98989d]">
        <span className="h-2 w-2 rounded-full" style={{ background: officer.rank.color }} />
        {officer.rank.name}
        <span className={cn(officer.status === 'TERMINATED' && 'text-[#fca5a5]')}>· {lspdStatusLabel(officer.status)}</span>
        {officer.units.length > 0 && <span>· {officer.units.map((unit) => unit.name).join(', ')}</span>}
      </span>
    </span>
  )
}
