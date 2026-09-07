'use client'

import { Checkbox } from '@/components/ui/checkbox'

interface UnitOption {
  key: string
  name: string
  group?: { name: string } | null
}

interface UnitMultiSelectProps {
  label?: string
  value: string[]
  units: UnitOption[] | undefined
  onChange: (value: string[]) => void
}

export function UnitMultiSelect({ label = 'Units', value, units, onChange }: UnitMultiSelectProps) {
  const selected = new Set(value)
  const groupedUnits = Array.from((units ?? []).reduce((groups, unit) => {
    const groupName = unit.group?.name ?? 'Eigenständige Units'
    const current = groups.get(groupName) ?? []
    current.push(unit)
    groups.set(groupName, current)
    return groups
  }, new Map<string, UnitOption[]>()).entries())

  const toggle = (key: string, checked: boolean) => {
    if (checked) {
      onChange(Array.from(new Set([...value, key])))
      return
    }
    onChange(value.filter((item) => item !== key))
  }

  return (
    <div>
      <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">{label}</p>
      <div className="space-y-3 rounded-[10px] border border-[#343434]/60 bg-[#181818]/35 p-3">
        {groupedUnits.map(([groupName, groupUnits]) => (
          <div key={groupName}>
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.11em] text-[#767676]">{groupName}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {groupUnits.map((unit) => (
                <Checkbox
                  key={unit.key}
                  checked={selected.has(unit.key)}
                  onCheckedChange={(checked) => toggle(unit.key, checked)}
                  label={unit.name}
                />
              ))}
            </div>
          </div>
        ))}
        {(!units || units.length === 0) && (
          <p className="text-[12.5px] text-[#808080]">Keine aktiven Units vorhanden</p>
        )}
      </div>
    </div>
  )
}
