'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { MAP_CATEGORIES, MAP_SPOT_LIMITS, type MapCategory, type MapSpot } from '@/lib/map-spots'

export interface SpotFormValues {
  title: string
  description: string
  category: MapCategory
  icon: string
}

function initialValues(spot: MapSpot | null): SpotFormValues {
  return {
    title: spot?.title ?? '',
    description: spot?.description ?? '',
    category: spot?.category ?? 'other',
    icon: spot?.icon ?? '',
  }
}

/**
 * Ein Dialog für beide Fälle: `spot === null` legt an der übergebenen Position
 * an, sonst wird eine bestehende Markierung bearbeitet.
 */
export function SpotEditorDialog({
  open,
  spot,
  position,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean
  spot: MapSpot | null
  position: { x: number; y: number } | null
  saving: boolean
  onClose: () => void
  onSubmit: (values: SpotFormValues) => Promise<void>
}) {
  const [form, setForm] = useState<SpotFormValues>(() => initialValues(spot))
  // Solange das Emoji nicht von Hand angefasst wurde, zieht es mit der Kategorie mit.
  const [iconTouched, setIconTouched] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(initialValues(spot))
    setIconTouched(Boolean(spot?.icon))
    setFailure('')
  }, [open, spot])

  const selectCategory = (next: MapCategory) => {
    setForm((prev) => ({
      ...prev,
      category: next,
      icon: iconTouched ? prev.icon : (MAP_CATEGORIES.find((item) => item.id === next)?.icon ?? ''),
    }))
  }

  const submit = async () => {
    if (!form.title.trim() || saving) return
    setFailure('')
    try {
      await onSubmit({ ...form, title: form.title.trim(), description: form.description.trim() })
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Die Markierung konnte nicht gespeichert werden.')
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={spot ? 'Markierung bearbeiten' : 'Markierung setzen'}
      description={
        position
          ? `Position ${position.x.toFixed(1)} / ${position.y.toFixed(1)}`
          : 'Titel, Notizen und Kategorie'
      }
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="w-[84px] shrink-0">
            <Input
              label="Emoji"
              value={form.icon}
              onChange={(event) => {
                setForm((prev) => ({ ...prev, icon: event.target.value }))
                setIconTouched(true)
              }}
              placeholder="📍"
              maxLength={MAP_SPOT_LIMITS.icon}
              className="text-center text-[16px]"
            />
          </div>
          <div className="flex-1">
            <Input
              label="Titel"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Zum Beispiel: Übergabepunkt am Hafen"
              maxLength={MAP_SPOT_LIMITS.title}
              autoFocus
            />
          </div>
        </div>

        <Textarea
          label="Notizen"
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          placeholder="Was muss das FIB über diesen Ort wissen?"
          maxLength={MAP_SPOT_LIMITS.description}
          rows={4}
        />

        <fieldset>
          <legend className="mb-1.5 block text-[12.5px] font-medium text-[#aeaeae]">Kategorie</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MAP_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => selectCategory(category.id)}
                aria-pressed={form.category === category.id}
                className={`flex h-9 items-center gap-2 rounded-[9px] border px-2.5 text-left text-[12px] font-medium transition-colors ${
                  form.category === category.id
                    ? 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#c4b5fd]'
                    : 'border-[#2a2a2a] bg-[#111111] text-[#a6a6a6] hover:border-[#404040] hover:text-white'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: category.hex }}
                />
                <span className="truncate">{category.label}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {failure && (
          <p role="alert" className="text-[12.5px] text-red-300">
            {failure}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={saving} disabled={!form.title.trim()} onClick={() => void submit()}>
            {spot ? 'Änderungen speichern' : 'Markierung speichern'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
