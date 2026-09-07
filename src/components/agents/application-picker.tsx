'use client'

import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { stripApplicationCaseNumber } from '@/lib/application-case-number'

export interface LinkableApplication {
  id: string
  caseNumber: string | null
  applicantDisplayName: string
  discordId: string
  discordUsername: string | null
  discordGlobalName: string | null
  status: string
  submittedAt: string
}

interface ApplicationPickerProps {
  applications: LinkableApplication[]
  value: string
  onChange: (applicationId: string) => void
}

function searchHaystack(application: LinkableApplication) {
  return [
    application.caseNumber,
    application.applicantDisplayName,
    application.discordId,
    application.discordUsername,
    application.discordGlobalName,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/**
 * Auswahl der zugehörigen Bewerbung. Die Liste enthält nur angenommene, noch
 * nicht eingestellte Bewerbungen — gesucht wird über Aktenzeichen, Name und
 * Discord-Kennung.
 */
export function ApplicationPicker({ applications, value, onChange }: ApplicationPickerProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return applications
    return applications.filter((application) => searchHaystack(application).includes(search))
  }, [applications, query])

  return (
    <div>
      <p className="mb-1.5 text-[12.5px] font-medium text-[#aeaeae]">Zugehörige Bewerbung</p>

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#808080]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Aktenzeichen, Name oder Discord-ID suchen"
          className="h-[36px] w-full rounded-[9px] border border-[#343434]/70 bg-[#181818] pl-8 pr-3 text-[13.5px] text-[#f4f4f4] outline-none transition-colors placeholder:text-[#808080] focus:border-[#d4d4d4]"
        />
      </div>

      <div className="mt-2 max-h-[212px] space-y-1 overflow-y-auto rounded-[9px] border border-[#343434]/55 bg-[#181818]/45 p-1.5">
        <PickerRow
          label="Keine Bewerbung verknüpfen"
          selected={value === ''}
          onSelect={() => onChange('')}
        />

        {filtered.map((application) => {
          // Der Anzeigename trägt das Aktenzeichen bereits — sonst stünde es
          // in beiden Zeilen.
          const name = stripApplicationCaseNumber(application.applicantDisplayName)
          return (
            <PickerRow
              key={application.id}
              label={application.caseNumber ? `${application.caseNumber} · ${name}` : name}
              meta={`eingereicht ${formatDate(application.submittedAt)}`}
              selected={value === application.id}
              onSelect={() => onChange(application.id)}
            />
          )
        })}

        {filtered.length === 0 && (
          <p className="px-2 py-3 text-center text-[12px] text-[#909090]">
            Keine passende Bewerbung gefunden.
          </p>
        )}
      </div>
    </div>
  )
}

function PickerRow({
  label,
  meta,
  selected,
  onSelect,
}: {
  label: string
  meta?: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-[8px] border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-[#d4d4d4]/40 bg-[#d4d4d4]/12'
          : 'border-transparent hover:bg-[#232323]/60',
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#d4d4d4]">
        {selected && <Check size={13} strokeWidth={2.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-white">{label}</span>
        {meta && <span className="mt-0.5 block truncate text-[11px] text-[#909090]">{meta}</span>}
      </span>
    </button>
  )
}
