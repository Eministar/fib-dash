'use client'

import { useState } from 'react'
import { MapPin, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { mapCategory, type MapSpot } from '@/lib/map-spots'
import { CityMap } from '@/components/map/city-map'
import { SpotEditorDialog, type SpotFormValues } from '@/components/map/spot-editor-dialog'

/** Was eine Akte von einem Kartenpunkt braucht. Absichtlich weniger als ein
 *  volles `MapSpot`, damit auch Ansichten mit verkürzter Auswahl den Picker
 *  ohne Typzusicherung befüllen können. */
export type PickedSpot = { id: string; title: string; category: string }

/**
 * Auswahl von Kartenpunkten für eine Akte. Nutzt bewusst dieselbe `CityMap`
 * wie die Kartenseite – ein zweiter, kleinerer Kartenrenderer würde nur
 * auseinanderlaufen.
 */
export function SpotPickerField({ value, onChange, canCreate }: { value: PickedSpot[]; onChange: (spots: PickedSpot[]) => void; canCreate: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null)
  const [placing, setPlacing] = useState(false)
  const { data, refetch } = useFetch<MapSpot[]>(open ? '/api/map/spots' : null)
  const { execute, loading: saving } = useApi<MapSpot>()

  const spots = data ?? []
  const selectedIds = value.map((spot) => spot.id)
  const toggle = (spot: PickedSpot) =>
    onChange(selectedIds.includes(spot.id)
      ? value.filter((entry) => entry.id !== spot.id)
      : [...value, { id: spot.id, title: spot.title, category: spot.category }])

  const visible = spots.filter((spot) => {
    const needle = search.trim().toLowerCase()
    if (!needle) return true
    return spot.title.toLowerCase().includes(needle) || mapCategory(spot.category).label.toLowerCase().includes(needle)
  })

  // Fehler zeigt der Editor-Dialog selbst an – deshalb hier bewusst kein catch.
  const createSpot = async (values: SpotFormValues) => {
    const created = await execute('/api/map/spots', {
      method: 'POST',
      body: JSON.stringify({ ...values, icon: values.icon.trim() || null, ...pendingPosition }),
    })
    setPendingPosition(null)
    setPlacing(false)
    await refetch()
    if (created) onChange([...value, { id: created.id, title: created.title, category: created.category }])
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-[#343434] px-4 py-5 text-sm text-[#808080]">
          <MapPin size={18} />
          Noch keine Kartenpunkte verknüpft.
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((spot) => (
            <li key={spot.id}>
              <button
                type="button"
                onClick={() => toggle(spot)}
                aria-label={`${spot.title} entfernen`}
                className="flex items-center gap-1.5 rounded-full border border-[#343434] px-3 py-1.5 text-[12px] text-[#d4d4d4] hover:border-[#fca5a5]"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: mapCategory(spot.category).hex }} />
                {spot.title}
                <span className="text-[#6a6a6a]">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <MapPin size={14} />
        Kartenpunkte wählen
      </Button>

      <Modal open={open} onClose={() => { setOpen(false); setPlacing(false); setPendingPosition(null) }} title="Kartenpunkte verknüpfen" size="xl">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="h-[52dvh] min-h-[320px]">
            <CityMap
              spots={visible}
              canManage={placing}
              selectable
              selectedIds={selectedIds}
              onPlace={(position) => { if (placing) setPendingPosition(position) }}
              onOpenDetail={toggle}
              movingSpot={null}
              moving={false}
              onMoveTo={() => {}}
              onCancelMove={() => {}}
              pendingPosition={pendingPosition}
            />
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            <Input aria-label="Kartenpunkt suchen" placeholder="Punkt oder Kategorie suchen …" value={search} onChange={(event) => setSearch(event.target.value)} />
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {visible.map((spot) => {
                const category = mapCategory(spot.category)
                return (
                  <li key={spot.id}>
                    <button
                      type="button"
                      onClick={() => toggle(spot)}
                      aria-pressed={selectedIds.includes(spot.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12.5px] ${selectedIds.includes(spot.id) ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-white' : 'border-[#282828] text-[#c4c4c4] hover:border-[#404040]'}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: category.hex }} />
                      <span className="min-w-0 truncate">{spot.title}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-[#6a6a6a]">{category.label}</span>
                    </button>
                  </li>
                )
              })}
              {visible.length === 0 && <li className="px-1 py-3 text-[12px] text-[#808080]">Keine passenden Punkte.</li>}
            </ul>

            {canCreate && (
              <Button type="button" size="sm" variant={placing ? 'primary' : 'outline'} onClick={() => { setPlacing(!placing); setPendingPosition(null) }}>
                <Plus size={14} />
                {placing ? 'Platzierung abbrechen' : 'Neuen Punkt setzen'}
              </Button>
            )}
            {placing && !pendingPosition && <p className="text-[11.5px] text-[#a6a6a6]">Klicke auf die Karte, um die Position zu wählen.</p>}
            <Button type="button" size="sm" onClick={() => setOpen(false)}>Fertig ({value.length})</Button>
          </div>
        </div>
      </Modal>

      <SpotEditorDialog
        open={Boolean(pendingPosition)}
        spot={null}
        position={pendingPosition}
        saving={saving}
        onClose={() => setPendingPosition(null)}
        onSubmit={createSpot}
      />
    </div>
  )
}
