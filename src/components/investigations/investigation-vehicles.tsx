'use client'

import { useMemo, useState } from 'react'
import { Car, Plus, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useFetch } from '@/hooks/use-fetch'
import { useInvestigationMutation } from '@/components/investigations/use-investigation-mutation'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type { InvestigationVehicleLink, Person, Vehicle } from '@/components/investigations/types'

export function vehicleLabel(vehicle: Vehicle) {
  const parts = [vehicle.plate, vehicle.model].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : vehicle.vehicleNumber
}

interface InvestigationVehiclesProps {
  investigationId: string
  vehicles: InvestigationVehicleLink[]
  canManage: boolean
  onChanged: () => void | Promise<void>
}

export function InvestigationVehicles({
  investigationId,
  vehicles,
  canManage,
  onChanged,
}: InvestigationVehiclesProps) {
  const { mutate, saving } = useInvestigationMutation(onChanged)
  const { toastError } = useInvestigationToast()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [vehicleId, setVehicleId] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState({ plate: '', model: '', color: '', ownerPersonId: '' })

  // Register und Personen nur laden, wenn der Dialog offen ist – die Detailseite
  // zieht sonst zwei Listen, die die meisten Aufrufe nie brauchen.
  const { data: register, refetch: refetchRegister } = useFetch<Vehicle[]>(
    open && canManage ? '/api/vehicles' : null,
  )
  const { data: persons } = useFetch<Person[]>(open && creating ? '/api/persons' : null)

  const linkedIds = useMemo(() => new Set(vehicles.map((link) => link.vehicleId)), [vehicles])
  const options = useMemo(
    () => [
      { value: '', label: 'Fahrzeug wählen' },
      ...(register ?? [])
        .filter((vehicle) => !linkedIds.has(vehicle.id))
        .map((vehicle) => ({ value: vehicle.id, label: `${vehicleLabel(vehicle)} (${vehicle.vehicleNumber})` })),
    ],
    [register, linkedIds],
  )

  const reset = () => {
    setVehicleId('')
    setNote('')
    setDraft({ plate: '', model: '', color: '', ownerPersonId: '' })
    setCreating(false)
  }

  const handleLink = async () => {
    const ok = await mutate(`/api/investigations/${investigationId}/vehicles`, {
      body: { vehicleId, note },
      successTitle: 'Fahrzeug verknüpft',
      errorTitle: 'Verknüpfen fehlgeschlagen',
    })
    if (ok) {
      reset()
      setOpen(false)
    }
  }

  const handleCreateAndLink = async () => {
    // Anlegen und Verknüpfen in einem Rutsch: das Register erst getrennt zu
    // pflegen wäre für den Regelfall ein unnötiger Umweg.
    try {
      const response = await fetch('/api/vehicles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, ownerPersonId: draft.ownerPersonId || null }),
      })
      const parsed = (await response.json()) as { success?: boolean; error?: string; data?: Vehicle }
      if (!response.ok || !parsed.success || !parsed.data) {
        throw new Error(parsed.error || 'Fahrzeug konnte nicht angelegt werden')
      }

      const ok = await mutate(`/api/investigations/${investigationId}/vehicles`, {
        body: { vehicleId: parsed.data.id, note },
        successTitle: 'Fahrzeug angelegt und verknüpft',
        errorTitle: 'Verknüpfen fehlgeschlagen',
      })
      await refetchRegister()
      if (ok) {
        reset()
        setOpen(false)
      }
    } catch (cause) {
      toastError('Anlegen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleUnlink = (link: InvestigationVehicleLink) =>
    mutate(`/api/investigations/vehicles/${link.id}`, {
      method: 'DELETE',
      successTitle: 'Fahrzeug entfernt',
      errorTitle: 'Entfernen fehlgeschlagen',
    })

  return (
    <Card className="mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-white">Fahrzeuge ({vehicles.length})</h2>
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Verknüpfen
          </Button>
        )}
      </div>

      {vehicles.length === 0 ? (
        <p className="py-3 text-[12.5px] text-[#6a6a6a]">Keine Fahrzeuge zu dieser Akte.</p>
      ) : (
        <ul className="divide-y divide-[#232323]">
          {vehicles.map((link) => (
            <li key={link.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Car className="h-3.5 w-3.5 shrink-0 text-[#6a6a6a]" />
                  <span className="text-[13.5px] font-medium text-white">
                    {vehicleLabel(link.vehicle)}
                  </span>
                  <span className="font-mono text-[11px] text-[#6a6a6a]">
                    {link.vehicle.vehicleNumber}
                  </span>
                  {link.vehicle.stolen && <Badge variant="danger">Als gestohlen gemeldet</Badge>}
                  {link.vehicle.wanted && <Badge variant="warning">Fahndung</Badge>}
                </div>
                <p className="mt-0.5 text-[11.5px] text-[#6a6a6a]">
                  {link.vehicle.color ? `${link.vehicle.color} · ` : ''}
                  {link.vehicle.ownerPerson
                    ? `Halter: ${link.vehicle.ownerPerson.firstName} ${link.vehicle.ownerPerson.lastName}`
                    : 'Halter unbekannt'}
                </p>
                {link.note && <p className="mt-0.5 text-[12px] text-[#a6a6a6]">{link.note}</p>}
              </div>

              {canManage && (
                <button
                  type="button"
                  onClick={() => void handleUnlink(link)}
                  className="shrink-0 text-[#6a6a6a] transition-colors hover:text-[#fca5a5]"
                  aria-label="Fahrzeug entfernen"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => {
          reset()
          setOpen(false)
        }}
        title="Fahrzeug verknüpfen"
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={creating ? 'ghost' : 'outline'}
              onClick={() => setCreating(false)}
            >
              Aus Register
            </Button>
            <Button
              size="sm"
              variant={creating ? 'outline' : 'ghost'}
              onClick={() => setCreating(true)}
            >
              Neu anlegen
            </Button>
          </div>

          {creating ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Kennzeichen"
                  value={draft.plate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, plate: event.target.value }))}
                  placeholder="z. B. 46EEK572"
                />
                <Input
                  label="Modell"
                  value={draft.model}
                  onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
                  placeholder="z. B. Sultan RS"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Farbe"
                  value={draft.color}
                  onChange={(event) => setDraft((prev) => ({ ...prev, color: event.target.value }))}
                />
                <Select
                  label="Halter"
                  options={[
                    { value: '', label: 'Unbekannt' },
                    ...(persons ?? []).map((person) => ({
                      value: person.id,
                      label: `${person.lastName}, ${person.firstName} (${person.personNumber})`,
                    })),
                  ]}
                  value={draft.ownerPersonId}
                  onValueChange={(value) => setDraft((prev) => ({ ...prev, ownerPersonId: value }))}
                />
              </div>
            </>
          ) : (
            <Select label="Fahrzeug" options={options} value={vehicleId} onValueChange={setVehicleId} />
          )}

          <Textarea
            label="Notiz"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Bezug zur Ermittlung"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              onClick={() => {
                reset()
                setOpen(false)
              }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={creating ? handleCreateAndLink : handleLink}
              loading={saving}
              disabled={creating ? !draft.plate && !draft.model : !vehicleId}
            >
              {creating ? 'Anlegen & verknüpfen' : 'Verknüpfen'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  )
}
