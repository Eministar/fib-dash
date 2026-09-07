'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DateField } from '@/components/ui/date-field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader } from '@/components/layout/page-header'
import { UnitMultiSelect } from '@/components/agents/unit-multi-select'
import { ApplicationPicker, type LinkableApplication } from '@/components/agents/application-picker'
import { stripApplicationCaseNumber } from '@/lib/application-case-number'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { ArrowLeft, FileSignature } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/context/auth-context'
import { hasPermission, PERMISSIONS } from '@/lib/permissions'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'

interface Rank {
  id: string
  name: string
  sortOrder: number
}

interface Unit {
  id: string
  key: string
  name: string
}

interface ContractTemplateOption {
  id: string
  name: string
  isDefault: boolean
}

/**
 * Zerlegt „Vorname Nachname“ aus der Bewerbung in die beiden Formularfelder.
 * Der Anzeigename trägt das Aktenzeichen („BW-0001 | Max Mustermann“), das hier
 * abgeschnitten wird.
 */
function splitApplicantName(value: string) {
  const parts = stripApplicationCaseNumber(value).split(' ')
  if (parts.length < 2) return { firstName: parts[0] ?? '', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export default function NewAgentPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const { user } = useAuth()
  const canCreate = hasPermission(user, 'agents:write')
  const globalAdministrator = Boolean(
    user && (
      user.groups.some((group) => ['admin', 'administration', 'administrator'].includes(group.name.toLowerCase())) ||
      PERMISSIONS.every((permission) => user.permissions.includes(permission))
    ),
  )
  const canAssignUnits = globalAdministrator || hasPermission(user, 'unit-leadership:manage')
  const { data: ranks } = useFetch<Rank[]>('/api/ranks')
  const { data: units } = useFetch<Unit[]>(canAssignUnits ? '/api/units?active=true&forAssignment=true' : null)
  const { data: applications } = useFetch<LinkableApplication[]>('/api/applications/linkable')
  const { data: contractTemplates } = useFetch<ContractTemplateOption[]>('/api/contract-templates?active=true')
  const { execute, loading } = useApi()

  /** Werte, die zuletzt aus einer Bewerbung übernommen wurden. */
  const autofilledRef = useRef<{ firstName: string; lastName: string; discordId: string } | null>(null)

  const [form, setForm] = useState({
    badgeNumber: '',
    firstName: '',
    lastName: '',
    rankId: '',
    discordId: '',
    notes: '',
    units: [] as string[],
    hireDate: new Date().toISOString().split('T')[0],
    applicationId: '',
    contractTemplateId: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Client-side guard so missing required fields show a clear message instead
    // of a cryptic 400 from the server validation.
    if (!form.firstName.trim() || !form.lastName.trim()) {
      addToast({ type: 'error', title: 'Fehlende Angaben', message: 'Vor- und Nachname sind erforderlich.' })
      return
    }
    if (!form.rankId) {
      addToast({ type: 'error', title: 'Rang fehlt', message: 'Bitte wähle einen Rang aus.' })
      return
    }
    const did = form.discordId.trim()
    if (did && !/^\d{17,22}$/.test(did)) {
      addToast({ type: 'error', title: 'Ungültige Discord-ID', message: 'Die Discord-ID muss 17–22 Ziffern haben (Snowflake).' })
      return
    }

    try {
      const payload = {
        ...form,
        discordId: did || null,
        applicationId: form.applicationId || null,
        contractTemplateId: form.contractTemplateId || null,
      }
      await execute('/api/agents', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      addToast({
        type: 'success',
        title: 'Agent erstellt',
        message: 'Der Arbeitsvertrag wurde zur Unterschrift verschickt.',
      })
      router.push('/agents')
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : 'Unbekannter Fehler' })
    }
  }

  const update = (key: string, value: string | string[]) => setForm(prev => ({ ...prev, [key]: value }))

  /**
   * Bewerbung auswählen: übernimmt Name und Discord-ID aus der Bewerbung.
   *
   * Beim Wechsel auf eine andere Bewerbung werden die zuvor übernommenen Werte
   * ersetzt — sonst blieben die Daten des vorherigen Bewerbers stehen. Von Hand
   * eingetippte Angaben bleiben erhalten: überschrieben wird nur, was leer ist
   * oder exakt aus der vorherigen Bewerbung stammt.
   */
  const selectApplication = (applicationId: string) => {
    const application = applications?.find((item) => item.id === applicationId) ?? null
    const incoming = application
      ? {
          ...splitApplicantName(application.applicantDisplayName),
          discordId: application.discordId,
        }
      : { firstName: '', lastName: '', discordId: '' }

    setForm((prev) => {
      const previous = autofilledRef.current
      // Überschrieben wird nur, was leer ist oder unverändert aus der zuvor
      // gewählten Bewerbung stammt — Handeingaben bleiben stehen.
      const takeOver = (current: string, previousAuto: string, next: string) => (
        !current.trim() || current === previousAuto ? next : current
      )

      return {
        ...prev,
        applicationId,
        firstName: takeOver(prev.firstName, previous?.firstName ?? '', incoming.firstName),
        lastName: takeOver(prev.lastName, previous?.lastName ?? '', incoming.lastName),
        discordId: takeOver(prev.discordId, previous?.discordId ?? '', incoming.discordId),
      }
    })

    autofilledRef.current = application ? incoming : null
  }

  if (!canCreate) return <UnauthorizedContent />

  return (
    <div>
      <PageHeader
        title="Neuer Agent"
        description="Neuen Mitarbeiter anlegen"
        action={
          <Link href="/agents">
            <Button variant="ghost" size="sm">
              <ArrowLeft size={15} strokeWidth={1.75} />
              Zurück
            </Button>
          </Link>
        }
      />

      <div className="glass-panel-elevated mx-auto w-full max-w-6xl rounded-[14px] p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Zwei Spalten: links die Stammdaten, rechts Bewerbung, Units und
              Vertrag. Einspaltig wurde das Formular unnötig schmal und lang. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  id="firstName"
                  label="Vorname"
                  value={form.firstName}
                  onChange={(e) => update('firstName', e.target.value)}
                  required
                />
                <Input
                  id="lastName"
                  label="Nachname"
                  value={form.lastName}
                  onChange={(e) => update('lastName', e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  id="badgeNumber"
                  label="Dienstnummer"
                  numericOnly
                  value={form.badgeNumber}
                  onChange={(e) => update('badgeNumber', e.target.value)}
                  placeholder="Automatisch nach Rang"
                />
                <Select
                  id="rankId"
                  label="Rang"
                  value={form.rankId}
                  onChange={(e) => update('rankId', e.target.value)}
                  options={ranks?.map(r => ({ value: r.id, label: r.name })) || []}
                  placeholder="Rang auswählen"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  id="discordId"
                  label="Discord-ID"
                  value={form.discordId}
                  onChange={(e) => update('discordId', e.target.value)}
                  placeholder="Optional (Snowflake)"
                  className="font-mono"
                />
                <DateField
                  id="hireDate"
                  label="Einstellungsdatum"
                  value={form.hireDate}
                  onChange={(v) => update('hireDate', v)}
                />
              </div>

              <Textarea
                id="notes"
                label="Notizen"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                rows={4}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-5">
              {(applications?.length ?? 0) > 0 && (
                <div className="rounded-[12px] border border-[#343434]/55 bg-[#181818]/40 p-3.5">
                  <ApplicationPicker
                    applications={applications ?? []}
                    value={form.applicationId}
                    onChange={selectApplication}
                  />
                  <p className="mt-1.5 text-[11.5px] leading-4 text-[#a6a6a6]">
                    Nur angenommene Bewerbungen, die noch nicht eingestellt wurden. Name und
                    Discord-ID werden automatisch übernommen.
                  </p>
                </div>
              )}

              {canAssignUnits ? (
                <UnitMultiSelect value={form.units} units={units ?? undefined} onChange={(value) => update('units', value)} />
              ) : (
                <div className="rounded-[10px] border border-[#343434]/50 bg-[#181818]/30 px-3 py-3 text-[11px] leading-5 text-[#858585]">
                  Unit-Zuweisungen können nur markierte Unit-Leitungen ihrer eigenen Gruppe oder globale Administratoren vornehmen.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[12px] border border-[#4a3a12]/45 bg-[#302712]/30 p-3.5">
            <div className="flex items-start gap-2.5">
              <FileSignature size={16} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
              <div>
                <p className="text-[13px] font-semibold text-white">
                  Arbeitsvertrag wird automatisch versendet
                </p>
                <p className="mt-1 text-[11.5px] leading-5 text-[#c6c6c6]">
                  Der Agent bekommt seinen persönlichen Vertragslink als Discord-DM; ist keine DM
                  möglich, wird die Aufforderung im Vertrags-Channel gepostet.{' '}
                  <strong className="font-semibold text-[#f0dfa8]">
                    Die Einstellung gilt erst als abgeschlossen, wenn der Vertrag unterschrieben ist.
                  </strong>
                </p>
              </div>
            </div>
            {(contractTemplates?.length ?? 0) > 1 && (
              <div className="mt-3">
                <Select
                  id="contractTemplateId"
                  label="Vertragsvorlage"
                  value={form.contractTemplateId}
                  onValueChange={(value) => update('contractTemplateId', value)}
                  options={(contractTemplates ?? []).map((template) => ({
                    value: template.id,
                    label: template.isDefault ? `${template.name} (Standard)` : template.name,
                  }))}
                  placeholder="Standardvorlage verwenden"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/agents">
              <Button type="button" variant="secondary" size="sm">Abbrechen</Button>
            </Link>
            <Button type="submit" size="sm" loading={loading}>
              Agent erstellen
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
