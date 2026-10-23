'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useApi } from '@/hooks/use-api'
import { DEFAULT_ALERT_SETTINGS } from '@/lib/storage-logs/storage-logs'

const DEFAULT_ALERT_USER_ID = '928021462386892830'

const KEYS = {
  logChannelId: 'storage.logChannelId',
  alertChannelId: 'storage.alertChannelId',
  alertUserId: 'storage.alertUserId',
  weaponThreshold: 'storage.weaponThreshold',
  itemThreshold: 'storage.itemThreshold',
  windowMinutes: 'storage.windowMinutes',
  cooldownMinutes: 'storage.cooldownMinutes',
  weaponItems: 'storage.weaponItems',
} as const
type Form = Record<keyof typeof KEYS, string>

function formFrom(settings: Record<string, string> | null): Form {
  const get = (key: keyof typeof KEYS, fallback = '') => settings?.[KEYS[key]] ?? fallback
  return {
    logChannelId: get('logChannelId'),
    alertChannelId: get('alertChannelId'),
    alertUserId: get('alertUserId', DEFAULT_ALERT_USER_ID),
    weaponThreshold: get('weaponThreshold', String(DEFAULT_ALERT_SETTINGS.weaponThreshold)),
    itemThreshold: get('itemThreshold', String(DEFAULT_ALERT_SETTINGS.itemThreshold)),
    windowMinutes: get('windowMinutes', String(DEFAULT_ALERT_SETTINGS.windowMinutes)),
    cooldownMinutes: get('cooldownMinutes', String(DEFAULT_ALERT_SETTINGS.cooldownMinutes)),
    weaponItems: get('weaponItems'),
  }
}

/** Lagerlogs: Quell-Channel des Webhooks, Warn-Channel, wer gepingt wird und ab wann. */
export function StorageLogSettings({ settings, channelOptions, onSaved }: {
  settings: Record<string, string> | null
  channelOptions: SelectOption[]
  onSaved: () => void
}) {
  const { execute, loading } = useApi()
  const { addToast } = useToast()
  const [form, setForm] = useState<Form>(() => formFrom(settings))
  useEffect(() => { setForm(formFrom(settings)) }, [settings])
  const set = (key: keyof Form) => (value: string) => setForm((previous) => ({ ...previous, [key]: value }))

  const save = async () => {
    if (form.alertUserId && !/^\d{17,22}$/.test(form.alertUserId.trim())) {
      addToast({ type: 'error', title: 'Discord-ID ungültig', message: 'Eine Discord-Benutzer-ID besteht aus 17–22 Ziffern.' })
      return
    }
    try {
      for (const key of Object.keys(KEYS) as (keyof typeof KEYS)[]) {
        await execute('/api/settings', { method: 'POST', body: JSON.stringify({ key: KEYS[key], value: form[key].trim() }) })
      }
      addToast({ type: 'success', title: 'Lagerlog-Einstellungen gespeichert' })
      onSaved()
    } catch (err) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }

  const sync = async () => {
    try {
      const result = await execute('/api/storage-logs/sync', { method: 'POST' }) as { fetched: number; created: number; linked: number } | null
      addToast({ type: 'success', title: 'Lagerlogs abgerufen', message: result ? `${result.created} neue Einträge, ${result.linked} nachträglich zugeordnet.` : undefined })
    } catch (err) {
      addToast({ type: 'error', title: 'Abruf fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Select label="Lager-Channel (Webhook)" value={form.logChannelId} onValueChange={set('logChannelId')} options={channelOptions} />
          <p className="mt-1.5 text-[11px] text-[#8e8e93]">Der Channel, in den der Fraklager-Webhook schreibt.</p>
        </div>
        <div>
          <Select label="Warnungen in" value={form.alertChannelId} onValueChange={set('alertChannelId')} options={channelOptions} />
          <p className="mt-1.5 text-[11px] text-[#8e8e93]">Leer lassen, um keine Warnungen zu senden.</p>
        </div>
      </div>
      <Input label="Bei Warnung pingen (Discord-ID)" value={form.alertUserId} onChange={(event) => set('alertUserId')(event.target.value)} inputMode="numeric" />
      <div className="grid gap-4 sm:grid-cols-4">
        <Input label="Waffen ab" type="number" min={0} value={form.weaponThreshold} onChange={(event) => set('weaponThreshold')(event.target.value)} />
        <Input label="Gegenstände ab" type="number" min={0} value={form.itemThreshold} onChange={(event) => set('itemThreshold')(event.target.value)} />
        <Input label="innerhalb (Min.)" type="number" min={1} value={form.windowMinutes} onChange={(event) => set('windowMinutes')(event.target.value)} />
        <Input label="Pause je Agent (Min.)" type="number" min={0} value={form.cooldownMinutes} onChange={(event) => set('cooldownMinutes')(event.target.value)} />
      </div>
      <p className="text-[11px] text-[#8e8e93]">Gezählt wird die entnommene Menge je Agent im Zeitfenster. 0 schaltet die jeweilige Grenze ab.</p>
      <Textarea label="Weitere Waffen (optional, je Zeile oder mit Komma)" rows={3} value={form.weaponItems} onChange={(event) => set('weaponItems')(event.target.value)} placeholder={'ammo\nkevlar'} />
      <p className="text-[11px] text-[#8e8e93]">Alles mit „WEAPON_“ zählt automatisch als Waffe. Hier ergänzt ihr Teilbegriffe, die ebenfalls zählen sollen.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} loading={loading}>Lagerlogs speichern</Button>
        <Button size="sm" variant="secondary" onClick={() => void sync()} disabled={!form.logChannelId}>Jetzt abrufen & Namen abgleichen</Button>
      </div>
    </div>
  )
}
