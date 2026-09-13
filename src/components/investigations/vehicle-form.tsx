'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PhotoField } from '@/components/investigations/photo-catalog'
import type { Person, Vehicle } from '@/components/investigations/types'

/**
 * Die Felder einer Fahrzeugakte. Anlegen und Bearbeiten teilen sich dieses
 * Fragment, damit ein neues Feld nicht an zwei Stellen nachgezogen werden muss
 * und die Fahrzeugakte in beiden Modalen gleich aussieht.
 */

const catalogPhotoUrl = (id: string) => `/api/investigations/photos/${id}/image`

export type VehicleForm = {
  photoId: string | null
  plate: string
  model: string
  color: string
  ownerPersonId: string
  notes: string
  stolen: boolean
  wanted: boolean
}

export function emptyVehicleForm(): VehicleForm {
  return { photoId: null, plate: '', model: '', color: '', ownerPersonId: '', notes: '', stolen: false, wanted: false }
}

export function vehicleFormFrom(vehicle: Vehicle): VehicleForm {
  return {
    photoId: vehicle.photoId,
    plate: vehicle.plate ?? '',
    model: vehicle.model ?? '',
    color: vehicle.color ?? '',
    ownerPersonId: vehicle.ownerPersonId ?? '',
    notes: vehicle.notes ?? '',
    stolen: vehicle.stolen,
    wanted: vehicle.wanted,
  }
}

/** Die Route verlangt Kennzeichen oder Modell – eines von beiden muss stehen. */
export function vehicleFormIsComplete(form: VehicleForm) {
  return Boolean(form.plate.trim() || form.model.trim())
}

export function VehicleFormFields({
  form,
  persons,
  onChange,
}: {
  form: VehicleForm
  persons: Person[]
  onChange: (next: VehicleForm) => void
}) {
  const patch = (fields: Partial<VehicleForm>) => onChange({ ...form, ...fields })
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Kennzeichen"
          value={form.plate}
          onChange={(event) => patch({ plate: event.target.value })}
          placeholder="z. B. 46EEK572"
        />
        <Input
          label="Modell"
          value={form.model}
          onChange={(event) => patch({ model: event.target.value })}
          placeholder="z. B. Sultan RS"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Farbe" value={form.color} onChange={(event) => patch({ color: event.target.value })} />
        <Select
          label="Halter"
          options={[
            { value: '', label: 'Unbekannt' },
            ...persons.map((person) => ({
              value: person.id,
              label: `${person.lastName}, ${person.firstName} (${person.personNumber})`,
            })),
          ]}
          value={form.ownerPersonId}
          onValueChange={(value) => patch({ ownerPersonId: value })}
        />
      </div>
      <PhotoField
        value={form.photoId ? catalogPhotoUrl(form.photoId) : null}
        onChange={(photo) => patch({ photoId: photo?.id ?? null })}
      />
      <Textarea
        label="Notizen"
        value={form.notes}
        onChange={(event) => patch({ notes: event.target.value })}
        rows={3}
      />
      <div className="flex flex-wrap gap-4">
        <Checkbox
          checked={form.stolen}
          onCheckedChange={(checked) => patch({ stolen: checked })}
          label="Als gestohlen gemeldet"
        />
        <Checkbox
          checked={form.wanted}
          onCheckedChange={(checked) => patch({ wanted: checked })}
          label="Zur Fahndung ausgeschrieben"
        />
      </div>
    </div>
  )
}
