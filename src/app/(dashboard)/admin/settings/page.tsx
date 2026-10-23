'use client'

import { useState, useEffect, useRef } from 'react'
import { Building2, CalendarDays, CheckCircle2, Clock, Hash, Link2, MessagesSquare, RefreshCw, Save, ShieldCheck, Sparkles, Tag, Users, X, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { TierManager } from '@/components/settings/tier-manager'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '@/lib/permissions'
import { StorageLogSettings } from '@/components/settings/storage-log-settings'

interface DiscordRole {
  id: string
  name: string
}

interface DiscordChannel {
  id: string
  name?: string
  /** 0 Text, 5 Ankündigung, 15 Forum. */
  type?: number
  parent_id?: string | null
}

interface DiscordRank {
  id: string
  name: string
}

interface DiscordTraining {
  id: string
  label: string
}

interface DiscordUnit {
  key: string
  name: string
}

interface UserGroup {
  id: string
  name: string
}

interface DiscordConfigResponse {
  botConfigured: boolean
  config: {
    guildId: string
    applicationId: string
    announcementsChannelId: string
    updateChannelId: string
    sanctionsChannelId: string
    investigationsChannelId: string
    photoCatalogChannelId: string
    dutyStatusChannelId: string
    codenameBoardChannelId: string
    dutyAdminLogChannelId: string
    dutyStatusMessageId: string
    absenceStatusChannelId: string
    weeklyReportChannelId: string
    absenceStatusMessageId: string
    humanResourcesRoleId: string
    clipsCategoryId: string
    clipsAnalystRoleId: string
    bodycamViewerRoleId: string
    hirePingChannelId: string
    promotionBlockRoleId: string
    leaveRoleId: string
    employeeRoleIds: string[]
    commandRoleIds: string[]
    authLoginRoleIds: string[]
    applicantRoleIds: string[]
    contractAuditorRoleIds: string[]
    authGroupRoleMap: Record<string, string[]>
    authRolePermissionMap: Record<string, Permission[]>
    rankRoleMap: Record<string, string>
    trainingRoleMap: Record<string, string>
    unitRoleMap: Record<string, string>
  }
  roles: DiscordRole[]
  channels: DiscordChannel[]
  categories: DiscordChannel[]
  ranks: DiscordRank[]
  trainings: DiscordTraining[]
  units: DiscordUnit[]
  userGroups: UserGroup[]
  diagnostics: {
    guildConfigured: boolean
    applicationConfigured: boolean
    publicKeyConfigured: boolean
    interactionEndpointUrl: string
    announcementsChannelConfigured: boolean
    updateChannelConfigured: boolean
    sanctionsChannelConfigured: boolean
    dutyAdminLogConfigured: boolean
    absenceStatusChannelConfigured: boolean
    rolesError: string | null
    channelsError: string | null
  }
}

interface FullSyncProgress {
  phase: 'starting' | 'checking' | 'syncing' | 'completed'
  total: number
  processed: number
  synced: number
  skipped: number
  failed: number
  current?: string
  message: string
  elapsedSeconds: number
  etaSeconds: number | null
}

interface FullSyncResult {
  synced: number
  skipped: number
  failed: number
  total: number
  message: string
}

type FullSyncStreamMessage =
  | { type: 'progress'; progress: FullSyncProgress }
  | { type: 'done'; data: FullSyncResult }
  | { type: 'error'; error: string }

export default function SettingsPage() {
  const { data: settings, loading, refetch } = useFetch<Record<string, string>>('/api/settings')
  const { data: discordData, loading: discordLoading, refetch: refetchDiscord } = useFetch<DiscordConfigResponse>('/api/discord/config')
  const { execute } = useApi()
  const { addToast } = useToast()
  const { data: dutyModeData, refetch: refetchDutyMode } = useFetch<{ mode: 'api' | 'manual' }>('/api/duty-times/mode')
  const { data: aiStatusData, refetch: refetchAiStatus } = useFetch<{ configured: boolean; enabled: boolean; model: string }>('/api/ai/status')
  const [dutyModeSaving, setDutyModeSaving] = useState(false)

  const [orgName, setOrgName] = useState('FIB')
  const [badgePrefix, setBadgePrefix] = useState('')
  const [codenamePrefix, setCodenamePrefix] = useState('Agent')
  const [allowDuplicateBadgeNumbers, setAllowDuplicateBadgeNumbers] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [discordForm, setDiscordForm] = useState<DiscordConfigResponse['config']>({
    guildId: '',
    applicationId: '',
    announcementsChannelId: '',
    updateChannelId: '',
    sanctionsChannelId: '',
    investigationsChannelId: '',
    photoCatalogChannelId: '',
    dutyStatusChannelId: '',
    codenameBoardChannelId: '',
    dutyAdminLogChannelId: '',
    dutyStatusMessageId: '',
    absenceStatusChannelId: '',
    weeklyReportChannelId: '',
    absenceStatusMessageId: '',
    humanResourcesRoleId: '',
    clipsCategoryId: '',
    clipsAnalystRoleId: '',
    bodycamViewerRoleId: '',
    hirePingChannelId: '',
    promotionBlockRoleId: '',
    leaveRoleId: '',
    employeeRoleIds: [],
    commandRoleIds: [],
    authLoginRoleIds: [],
    applicantRoleIds: [],
    contractAuditorRoleIds: [],
    authGroupRoleMap: {},
    authRolePermissionMap: {},
    rankRoleMap: {},
    trainingRoleMap: {},
    unitRoleMap: {},
  })

  const settingsInitialized = useRef(false)
  const discordInitialized = useRef(false)

  useEffect(() => {
    if (settings && !settingsInitialized.current) {
      settingsInitialized.current = true
      setOrgName(settings['orgName'] || 'FIB')
      setBadgePrefix(settings['badgePrefix'] || '')
      setCodenamePrefix(settings['codenames.prefix'] ?? 'Agent')
      setAllowDuplicateBadgeNumbers(settings['allowDuplicateBadgeNumbers'] === 'true')
      setAiEnabled(settings['ai.enabled'] !== 'false')
    }
  }, [settings])

  useEffect(() => {
    if (discordData && !discordInitialized.current) {
      discordInitialized.current = true
      setDiscordForm(discordData.config)
    }
  }, [discordData])

  const saveSetting = async (key: string, value: string) => {
    try {
      await execute('/api/settings', { method: 'POST', body: JSON.stringify({ key, value }) })
      addToast({ type: 'success', title: 'Einstellung gespeichert' })
      settingsInitialized.current = false
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const changeDutyMode = async (mode: 'api' | 'manual') => {
    setDutyModeSaving(true)
    try {
      await execute('/api/duty-times/mode', { method: 'PUT', body: JSON.stringify({ mode }) })
      addToast({ type: 'success', title: mode === 'manual' ? 'Manuelles Einstempeln aktiv' : 'Automatische Erfassung aktiv', message: 'Ankündigung im Dienstzeiten-Channel gesendet.' })
      await refetchDutyMode()
    } catch (err) {
      addToast({ type: 'error', title: 'Umstellen fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setDutyModeSaving(false)
    }
  }

  const saveDiscordConfig = async () => {
    try {
      await execute('/api/discord/config', { method: 'POST', body: JSON.stringify(discordForm) })
      addToast({ type: 'success', title: 'Discord-Konfiguration gespeichert' })
      discordInitialized.current = false
      await refetchDiscord()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const registerCommands = async () => {
    try {
      await execute('/api/discord/register-commands', { method: 'POST' })
      addToast({ type: 'success', title: 'Discord-Commands registriert' })
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const publishDutyEmbed = async () => {
    try {
      await execute('/api/duty-times/discord-message', { method: 'POST' })
      addToast({ type: 'success', title: 'Discord-Dienststatus aktualisiert' })
      discordInitialized.current = false
      await refetchDiscord()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const publishAbsenceEmbed = async () => {
    try {
      await execute('/api/absences/discord-message', { method: 'POST' })
      addToast({ type: 'success', title: 'Discord-Abmeldungen aktualisiert' })
      discordInitialized.current = false
      await refetchDiscord()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const [fullSyncLoading, setFullSyncLoading] = useState(false)
  const [fullSyncProgress, setFullSyncProgress] = useState<FullSyncProgress | null>(null)
  const [fullSyncResult, setFullSyncResult] = useState<FullSyncResult | null>(null)

  const fullSync = async () => {
    setFullSyncLoading(true)
    setFullSyncProgress(null)
    setFullSyncResult(null)
    try {
      const res = await fetch('/api/discord/full-sync', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'include',
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let message = 'Full-Sync fehlgeschlagen'
        try {
          const parsed = JSON.parse(text) as { error?: string }
          message = parsed.error || message
        } catch {
          if (text) message = text
        }
        throw new Error(message)
      }

      if (!res.body) throw new Error('Server hat keinen Sync-Stream gesendet')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let result: FullSyncResult | null = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as FullSyncStreamMessage
          if (event.type === 'progress') {
            setFullSyncProgress(event.progress)
          } else if (event.type === 'done') {
            result = event.data
            setFullSyncResult(event.data)
          } else if (event.type === 'error') {
            throw new Error(event.error)
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as FullSyncStreamMessage
        if (event.type === 'progress') setFullSyncProgress(event.progress)
        if (event.type === 'done') {
          result = event.data
          setFullSyncResult(event.data)
        }
        if (event.type === 'error') throw new Error(event.error)
      }

      if (!result) throw new Error('Full-Sync wurde ohne Ergebnis beendet')
      addToast({
        type: result.failed > 0 ? 'warning' : 'success',
        title: 'Discord Full-Sync abgeschlossen',
        message: result.message,
      })
      discordInitialized.current = false
      await refetchDiscord()
    } catch (err) {
      addToast({ type: 'error', title: 'Full-Sync fehlgeschlagen', message: err instanceof Error ? err.message : '' })
    } finally {
      setFullSyncLoading(false)
    }
  }

  const addRole = (field: 'employeeRoleIds' | 'commandRoleIds' | 'authLoginRoleIds' | 'applicantRoleIds' | 'contractAuditorRoleIds', roleId: string) => {
    if (!roleId) return
    setDiscordForm((prev) => ({
      ...prev,
      [field]: Array.from(new Set([...prev[field], roleId])),
    }))
  }

  const removeRole = (field: 'employeeRoleIds' | 'commandRoleIds' | 'authLoginRoleIds' | 'applicantRoleIds' | 'contractAuditorRoleIds', roleId: string) => {
    setDiscordForm((prev) => ({
      ...prev,
      [field]: prev[field].filter((id) => id !== roleId),
    }))
  }

  const setRoleMap = (field: 'rankRoleMap' | 'trainingRoleMap' | 'unitRoleMap', key: string, roleId: string) => {
    setDiscordForm((prev) => {
      const next = { ...prev[field] }
      if (roleId) next[key] = roleId
      else delete next[key]
      return { ...prev, [field]: next }
    })
  }

  const addAuthGroupRole = (groupId: string, roleId: string) => {
    if (!roleId) return
    setDiscordForm((prev) => {
      const next = { ...prev.authGroupRoleMap }
      next[groupId] = Array.from(new Set([...(next[groupId] ?? []), roleId]))
      return { ...prev, authGroupRoleMap: next }
    })
  }

  const removeAuthGroupRole = (groupId: string, roleId: string) => {
    setDiscordForm((prev) => {
      const next = { ...prev.authGroupRoleMap }
      const remaining = (next[groupId] ?? []).filter((id) => id !== roleId)
      if (remaining.length > 0) next[groupId] = remaining
      else delete next[groupId]
      return { ...prev, authGroupRoleMap: next }
    })
  }

  const addRolePermissionRole = (roleId: string) => {
    if (!roleId) return
    setDiscordForm((prev) => {
      if (prev.authRolePermissionMap[roleId]) return prev
      return { ...prev, authRolePermissionMap: { ...prev.authRolePermissionMap, [roleId]: [] } }
    })
  }

  const removeRolePermissionRole = (roleId: string) => {
    setDiscordForm((prev) => {
      const next = { ...prev.authRolePermissionMap }
      delete next[roleId]
      return { ...prev, authRolePermissionMap: next }
    })
  }

  const toggleRolePermission = (roleId: string, permission: Permission, checked: boolean) => {
    setDiscordForm((prev) => {
      const current = prev.authRolePermissionMap[roleId] ?? []
      const nextPermissions = checked
        ? Array.from(new Set([...current, permission]))
        : current.filter((item) => item !== permission)
      return { ...prev, authRolePermissionMap: { ...prev.authRolePermissionMap, [roleId]: nextPermissions } }
    })
  }

  if (loading || discordLoading) return <PageLoader withHeader />

  const roleOptions = [
    { value: '', label: 'Keine Rolle' },
    ...(discordData?.roles.map((role) => ({ value: role.id, label: role.name })) || []),
  ]
  // Channels kommen in Discord-Reihenfolge; die Kategorie wird zur Gruppenüberschrift.
  const categoryName = new Map((discordData?.categories ?? []).map((category) => [category.id, category.name || category.id]))
  const channelOptions: SelectOption[] = [
    { value: '', label: 'Kein Channel' },
    ...(discordData?.channels.map((channel) => ({
      value: channel.id,
      label: `#${channel.name || channel.id}${channel.type === 15 ? ' (Forum)' : ''}`,
      group: channel.parent_id ? categoryName.get(channel.parent_id) ?? 'Unbekannte Kategorie' : 'Ohne Kategorie',
    })) || []),
  ]
  // Nur das Ermittlungs-Forum legt Beiträge an; alle anderen Meldungen posten direkt und brauchen einen Text-Channel.
  const textChannelOptions = channelOptions.filter((option) => !option.label.endsWith(' (Forum)'))
  const roleName = (roleId: string) => discordData?.roles.find((role) => role.id === roleId)?.name || roleId
  const syncPercent = fullSyncResult
    ? 100
    : fullSyncProgress?.total
    ? Math.round((fullSyncProgress.processed / fullSyncProgress.total) * 100)
    : 0
  const formatSeconds = (seconds: number | null) => {
    if (seconds === null) return 'Berechne…'
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  const renderRolePicker = (field: 'employeeRoleIds' | 'commandRoleIds' | 'authLoginRoleIds' | 'applicantRoleIds' | 'contractAuditorRoleIds') => {
    const selected = discordForm[field]
    const options = [
      { value: '', label: 'Rolle hinzufügen' },
      ...(discordData?.roles
          .filter((role) => !selected.includes(role.id))
          .map((role) => ({ value: role.id, label: role.name })) || []),
    ]

    return (
        <div className="space-y-2">
          <Select
              value=""
              onValueChange={(roleId) => addRole(field, roleId)}
              options={options}
              size="sm"
          />
          <RoleChips roleIds={selected} roleName={roleName} onRemove={(roleId) => removeRole(field, roleId)} />
        </div>
    )
  }

  const channelField = (
      label: string,
      field: ChannelField,
      hint: string,
      options: SelectOption[] = textChannelOptions,
      extra?: React.ReactNode,
  ) => (
      <div>
        <Select
            label={label}
            value={discordForm[field] ?? ''}
            onValueChange={(value) => setDiscordForm({ ...discordForm, [field]: value })}
            options={options}
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#8e8e93]">{hint}</p>
        {extra}
      </div>
  )

  const roleField = (label: string, field: RoleField, hint: string) => (
      <div>
        <Select
            label={label}
            value={discordForm[field]}
            onValueChange={(value) => setDiscordForm({ ...discordForm, [field]: value })}
            options={roleOptions}
        />
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#8e8e93]">{hint}</p>
      </div>
  )

  const diag = discordData?.diagnostics
  const healthItems: { ok: boolean; label: string }[] = diag ? [
    { ok: discordData?.botConfigured ?? false, label: 'Bot-Token' },
    { ok: diag.guildConfigured, label: 'Guild-ID' },
    { ok: diag.applicationConfigured, label: 'Application-ID' },
    { ok: diag.publicKeyConfigured, label: 'Public-Key' },
    { ok: diag.announcementsChannelConfigured, label: 'Ankündigungs-Channel' },
    { ok: diag.sanctionsChannelConfigured, label: 'Sanktions-Channel' },
    { ok: diag.absenceStatusChannelConfigured, label: 'Abmeldungs-Channel' },
  ] : []
  const healthIssues = healthItems.filter((item) => !item.ok).length

  return (
      <div className="pb-20">
        <PageHeader title="Einstellungen" description="Systemweite Konfiguration für Organisation und Discord-Bot" />

        {/* Bereichsnavigation */}
        <nav aria-label="Bereiche" className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-5 backdrop-blur-md bg-[#000000]/85 border-b border-[#38383a]/40">
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-4xl">
            {[
              { id: 'general', label: 'Allgemein', icon: Building2 },
              { id: 'duty-mode', label: 'Dienstzeiten', icon: Clock },
              { id: 'ai', label: 'KI-Assistent', icon: Sparkles },
              { id: 'discord-basics', label: 'Discord', icon: MessagesSquare },
              { id: 'channels', label: 'Channels', icon: Hash },
              { id: 'roles', label: 'Rollen', icon: ShieldCheck },
              { id: 'mappings', label: 'Zuordnungen', icon: Tag },
            ].map((item) => (
                <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium text-[#98989d] hover:text-white hover:bg-[#2c2c2e] transition-colors whitespace-nowrap"
                >
                  <item.icon size={13} aria-hidden /> {item.label}
                </a>
            ))}
          </div>
        </nav>

        <div className="space-y-4 max-w-4xl">
          {discordData && (
              <SettingsSection
                  icon={healthIssues ? XCircle : CheckCircle2}
                  iconClassName={healthIssues ? 'text-[#fbbf24]' : 'text-[#22c55e]'}
                  title="System-Status"
                  description={healthIssues ? `${healthIssues} ${healthIssues === 1 ? 'Punkt braucht' : 'Punkte brauchen'} Aufmerksamkeit` : 'Alles eingerichtet'}
                  action={<Button variant="secondary" size="sm" onClick={refetchDiscord}><RefreshCw size={13} /> Neu prüfen</Button>}
              >
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {healthItems.map((h) => (
                      <div key={h.label} className={cn('health-pill justify-start', h.ok ? 'ok' : 'warn')}>
                        {h.ok ? <CheckCircle2 size={12} aria-hidden /> : <XCircle size={12} aria-hidden />} {h.label}
                      </div>
                  ))}
                </div>
                {diag?.interactionEndpointUrl && (
                    <div className="mt-3 rounded-[10px] border border-[#3a3a3c] bg-[#161617] px-3 py-2 text-[11.5px] text-[#98989d] flex items-center gap-2">
                      <Link2 size={13} className="text-[#d4d4d4] shrink-0" aria-hidden />
                      <span className="truncate">Interactions Endpoint URL in Discord: <code className="text-[#f5f5f7]">{diag.interactionEndpointUrl}</code></span>
                    </div>
                )}
              </SettingsSection>
          )}

          <SettingsSection id="general" icon={Building2} title="Allgemein" description="Name der Organisation, Präfixe für Decknamen und Dienstnummern.">
            <div className="grid gap-4 sm:grid-cols-3">
              <InlineSave label="Organisationsname" value={orgName} onChange={setOrgName} onSave={() => saveSetting('orgName', orgName)} />
              <InlineSave label="Decknamen-Präfix" value={codenamePrefix} onChange={setCodenamePrefix} onSave={() => saveSetting('codenames.prefix', codenamePrefix)} placeholder="Agent" maxLength={40} />
              <InlineSave label="Dienstnummer-Präfix" value={badgePrefix} onChange={setBadgePrefix} onSave={() => saveSetting('badgePrefix', badgePrefix)} placeholder="z.B. FIB-" />
            </div>
            <div className="mt-4 rounded-[10px] border border-[#3d2d12] bg-[#1d1608]/70 p-3">
              <Checkbox
                checked={allowDuplicateBadgeNumbers}
                onCheckedChange={setAllowDuplicateBadgeNumbers}
                label="Temporär doppelte Dienstnummern erlauben"
              />
              <p className="mt-2 text-[11.5px] leading-5 text-[#c7c7cc]">
                Nur als Übergang nutzen, um Agents sauber in Ränge zu sortieren. Gesperrte Dienstnummern bleiben weiterhin blockiert.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => saveSetting('allowDuplicateBadgeNumbers', allowDuplicateBadgeNumbers ? 'true' : 'false')}
              >
                <Save size={13} /> Speichern
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection
              id="duty-mode"
              icon={Clock}
              title="Dienstzeit-Erfassung"
              description="Falls die Dienstzeiten-API ausfällt, auf manuelles Einstempeln umschalten. Beim Umschalten werden offene Sitzungen beendet, eine Ankündigung ohne Ping in den Dienstzeiten-Channel gestellt und das Panel neu gesetzt."
          >
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Dienstzeit-Erfassung">
              {([
                { mode: 'api', title: 'Automatisch (API)', text: 'Dienstzeit kommt aus der Player-Online-API.' },
                { mode: 'manual', title: 'Manuell einstempeln', text: 'Ein-/Ausstempeln im Dashboard oder per Discord-Button. Nach 8 Stunden fragt der Bot nach; ohne Antwort binnen einer Minute wird automatisch ausgestempelt.' },
              ] as const).map((option) => {
                const active = dutyModeData?.mode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={dutyModeSaving || !dutyModeData || active}
                    onClick={() => changeDutyMode(option.mode)}
                    className={cn('rounded-[10px] border p-3 text-left transition-colors disabled:cursor-default', active ? 'border-[#98989d] bg-[#2c2c2e]' : 'border-[#38383a] hover:bg-[#1c1c1e]')}
                  >
                    <span className="block text-[13px] font-medium text-white">{option.title}{active ? ' · aktiv' : ''}</span>
                    <span className="mt-1 block text-[11.5px] leading-relaxed text-[#8e8e93]">{option.text}</span>
                  </button>
                )
              })}
            </div>
          </SettingsSection>

          <SettingsSection
              id="ai"
              icon={Sparkles}
              title="KI-Assistent"
              description="Formuliert aus Stichwörtern Chronologie-Einträge und neue Einsatzakten, im Dashboard und per /fib-ki. Schreibt ein Agent im Discord-Beitrag einer Akte, antwortet der Bot mit einem Vorschlag: ausformulierter Eintrag, Änderungen an der Akte (Status, Priorität, Fallführung, Ermittler, Personen, Fahrzeuge, Titel) und Anhänge. Mit „Übernehmen“ wird alles im Namen des Agents ausgeführt. Kurz, sachlich, ohne erfundene Angaben."
          >
            {aiStatusData && !aiStatusData.configured && (
                <Notice tone="warn">Kein API-Key hinterlegt. Trage <code>DEEPSEEK_API_KEY</code> in die Umgebungsdatei (.env) des Servers ein und starte ihn neu. Bis dahin ist der KI-Knopf ausgeblendet.</Notice>
            )}
            <div className="rounded-[10px] border border-[#38383a] bg-[#161617] p-3">
              <Checkbox
                  checked={aiEnabled}
                  onCheckedChange={setAiEnabled}
                  disabled={!aiStatusData?.configured}
                  label="KI-Assistent aktiv"
              />
              <p className="mt-2 text-[11.5px] leading-relaxed text-[#8e8e93]">
                Ausgeschaltet verschwindet der KI-Knopf überall, und auch der Discord-Befehl lehnt ab.
                {aiStatusData?.configured && <> Modell: <code className="text-[#d4d4d4]">{aiStatusData.model}</code> (änderbar über <code>DEEPSEEK_MODEL</code>).</>}
              </p>
              <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  disabled={!aiStatusData?.configured}
                  onClick={async () => { await saveSetting('ai.enabled', aiEnabled ? 'true' : 'false'); await refetchAiStatus() }}
              >
                <Save size={13} /> Speichern
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection
              id="discord-basics"
              icon={MessagesSquare}
              title="Discord-Verbindung"
              description="Der Bot-Token kommt aus der Umgebung. Server, Channels, Rollen und Command-Rechte werden hier gepflegt."
          >
            {!discordData?.botConfigured && (
                <Notice tone="warn">DISCORD_BOT_TOKEN ist nicht gesetzt. Die Oberfläche kann gespeichert werden, Discord-Rollen und Channel werden aber erst mit Bot-Token geladen.</Notice>
            )}
            {discordData && !discordData.diagnostics.guildConfigured && (
                <Notice tone="warn">Guild-ID fehlt. Setze sie hier oder über DISCORD_GUILD_ID, sonst können Rollen und Commands nicht geladen werden.</Notice>
            )}
            {discordData && !discordData.diagnostics.publicKeyConfigured && (
                <Notice tone="warn">DISCORD_PUBLIC_KEY fehlt. Discord-Buttons und Modals werden ohne diesen Public Key von der App abgelehnt.</Notice>
            )}
            {discordData?.diagnostics.rolesError && <Notice tone="error">Rollen konnten nicht geladen werden: {discordData.diagnostics.rolesError}</Notice>}
            {discordData?.diagnostics.channelsError && <Notice tone="error">Channel konnten nicht geladen werden: {discordData.diagnostics.channelsError}</Notice>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                  label="Guild-ID"
                  value={discordForm.guildId}
                  onChange={(e) => setDiscordForm({ ...discordForm, guildId: e.target.value })}
                  placeholder="Discord Server-ID"
              />
              <Input
                  label="Application-ID"
                  value={discordForm.applicationId}
                  onChange={(e) => setDiscordForm({ ...discordForm, applicationId: e.target.value })}
                  placeholder="Discord App-ID"
              />
            </div>

            <div className="mt-5 border-t border-[#38383a]/50 pt-4">
              <p className="text-[12.5px] font-medium text-[#d2d2d2]">Werkzeuge</p>
              <p className="mt-0.5 mb-3 text-[11.5px] text-[#8e8e93]">Wirken sofort, unabhängig vom Speichern.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={fullSync} disabled={fullSyncLoading}>
                  {fullSyncLoading ? <><RefreshCw size={13} className="animate-spin" /> Synchronisiere…</> : <><Users size={13} /> Alle Agents synchronisieren</>}
                </Button>
                <Button variant="secondary" size="sm" onClick={registerCommands}><ShieldCheck size={13} /> Commands registrieren</Button>
                <Button variant="secondary" size="sm" onClick={publishDutyEmbed}><Clock size={13} /> Dienstzeiten-Panel neu setzen</Button>
                <Button variant="secondary" size="sm" onClick={publishAbsenceEmbed}><CalendarDays size={13} /> Abmeldungs-Panel neu setzen</Button>
              </div>
            </div>

            {(fullSyncProgress || fullSyncResult) && (
              <div className="mt-4 rounded-[10px] border border-[#3a3a3c] bg-[#161617] px-3 py-3" aria-live="polite">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-[#f5f5f7]">
                      {fullSyncProgress?.message ?? fullSyncResult?.message ?? 'Full-Sync'}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[#8e8e93]">
                      {fullSyncProgress?.current ? `Aktuell: ${fullSyncProgress.current}` : 'Kein Agent aktiv'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-[11px] text-[#98989d]">
                    <span>{fullSyncProgress?.processed ?? fullSyncResult?.total ?? 0}/{fullSyncProgress?.total ?? fullSyncResult?.total ?? 0}</span>
                    <span>{syncPercent}%</span>
                    <span>Rest: {formatSeconds(fullSyncProgress?.etaSeconds ?? null)}</span>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#2c2c2e]">
                  <div
                    className="h-full rounded-full bg-[#d4d4d4] transition-[width] duration-200"
                    style={{ width: `${fullSyncResult ? 100 : syncPercent}%` }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#98989d] sm:grid-cols-4">
                  <span>Synchronisiert: <b className="text-[#f5f5f7]">{fullSyncProgress?.synced ?? fullSyncResult?.synced ?? 0}</b></span>
                  <span>Übersprungen: <b className="text-[#f5f5f7]">{fullSyncProgress?.skipped ?? fullSyncResult?.skipped ?? 0}</b></span>
                  <span>Fehler: <b className={cn((fullSyncProgress?.failed ?? fullSyncResult?.failed ?? 0) > 0 ? 'text-[#fca5a5]' : 'text-[#f5f5f7]')}>{fullSyncProgress?.failed ?? fullSyncResult?.failed ?? 0}</b></span>
                  <span>Laufzeit: <b className="text-[#f5f5f7]">{formatSeconds(fullSyncProgress?.elapsedSeconds ?? null)}</b></span>
                </div>
              </div>
            )}
          </SettingsSection>

          <SettingsSection id="channels" icon={Hash} title="Channels" description="Die Auswahl zeigt die Channels in der Reihenfolge und unter den Kategorien wie in Discord.">
            <ChannelGroup title="Meldungen">
              {channelField('Ankündigungs-Channel', 'announcementsChannelId', 'Personalmeldungen wie Einstellungen, Rangänderungen und Kündigungen.')}
              {channelField('Update-Channel', 'updateChannelId', 'Update-Mitteilungen. Leer lassen, um den Ankündigungs-Channel zu nutzen.')}
              {channelField('Sanktions-Channel', 'sanctionsChannelId', 'Neue Sanktionen. Leer lassen, um den Ankündigungs-Channel zu nutzen.')}
              {channelField('Neueinstellung: Kurz-Ping', 'hirePingChannelId', 'Ein neu angelegter Agent wird hier einmal kurz erwähnt; die Nachricht verschwindet nach etwa einer Sekunde. Ohne Discord-ID passiert nichts. Leer bedeutet deaktiviert.')}
            </ChannelGroup>

            <ChannelGroup title="Dienst & Abwesenheit">
              {channelField('Dienstzeiten-Channel', 'dutyStatusChannelId', 'Öffentliches Panel mit allen Agents im Dienst. Im manuellen Modus mit Ein-/Ausstempel-Buttons.')}
              {channelField('Dienstzeit-Protokoll (Admin)', 'dutyAdminLogChannelId', 'Optionaler Admin-Channel für Dienstzeit-Hinweise. Leer lassen, um den Ankündigungs-Channel zu nutzen.')}
              {channelField('Abmeldungs-Channel', 'absenceStatusChannelId', 'Öffentliches Panel mit allen aktuell abgemeldeten Agents. Leer lassen, um den Dienstzeiten- oder Ankündigungs-Channel zu nutzen.')}
              {channelField('Wochenbericht an die Leitung', 'weeklyReportChannelId', 'Jeden Montag ab 8 Uhr: Einstellungen, Kündigungen, Rangänderungen, Sanktionen und Dienststunden der Vorwoche im Vergleich zur Woche davor. Leer lassen, um keinen Bericht zu senden.', textChannelOptions, (
                  <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={!discordForm.weeklyReportChannelId}
                      onClick={async () => {
                        try {
                          await execute('/api/discord/weekly-report', { method: 'POST' })
                          addToast({ type: 'success', title: 'Testbericht gesendet', message: 'Bericht der Vorwoche im eingestellten Channel.' })
                        } catch (err) {
                          addToast({ type: 'error', title: 'Wochenbericht fehlgeschlagen', message: err instanceof Error ? err.message : '' })
                        }
                      }}
                  >
                    Testbericht jetzt senden
                  </Button>
              ))}
            </ChannelGroup>

            <ChannelGroup title="Ermittlungen">
              {channelField('Ermittlungs-Channel', 'investigationsChannelId', 'Am besten ein Forum: Jede Einsatzakte bekommt einen eigenen Beitrag mit Aktenkarte und Verlauf, jede Familienakte einen Beitrag mit Tag „Familienakte“, dazu eine angepinnte Übersicht. Der Bot braucht dort „Beiträge erstellen“, „In Threads schreiben“ und „Kanäle verwalten“. Leer lassen, um die Meldungen abzuschalten.', channelOptions, (
                  <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={!discordForm.investigationsChannelId}
                      onClick={async () => {
                        try {
                          await execute('/api/discord/investigations-forum', { method: 'POST' })
                          addToast({ type: 'success', title: 'Forum wird aufgebaut', message: 'Beiträge für laufende Akten und alle Familienakten entstehen im Hintergrund.' })
                        } catch (err) {
                          addToast({ type: 'error', title: 'Forum nicht aufgebaut', message: err instanceof Error ? err.message : '' })
                        }
                      }}
                  >
                    Forum aufbauen
                  </Button>
              ))}
              {channelField('Bildkatalog-Channel', 'photoCatalogChannelId', 'Bild-Uploads erscheinen automatisch unter Ermittlungen → Bildkatalog. Der Bot braucht Kanalzugriff, Nachrichtenverlauf und den Message Content Intent. Eine Umgebungsvariable hat Vorrang.')}
            </ChannelGroup>

            <ChannelGroup title="Decknamen & Clips">
              {channelField('Decknamen-Board', 'codenameBoardChannelId', 'Aktuelle Belegung. Leer lassen, um das Board abzuschalten. Eine gesetzte Umgebungsvariable hat Vorrang.')}
              <div>
                <Select
                    label="Clips-Channels: Kategorie"
                    value={discordForm.clipsCategoryId}
                    onValueChange={(clipsCategoryId) => setDiscordForm({ ...discordForm, clipsCategoryId })}
                    options={[
                      { value: '', label: 'Kategorie auswählen' },
                      ...(discordData?.categories?.map(category => ({ value: category.id, label: category.name || category.id })) || []),
                    ]}
                />
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-[#8e8e93]">Jeder Agent mit Discord-Verknüpfung bekommt hier einen privaten Clips-Channel, sortiert wie die Mitarbeiterliste. Beim Speichern werden bestehende Channels dorthin verschoben. Discord erlaubt höchstens 50 Channels pro Kategorie.</p>
              </div>
            </ChannelGroup>

            <ChannelGroup title="Lagerlogs" single>
              <StorageLogSettings settings={settings ?? null} channelOptions={textChannelOptions} onSaved={() => void refetch()} />
            </ChannelGroup>
          </SettingsSection>

          <SettingsSection id="roles" icon={ShieldCheck} title="Rollen" description="Rollen, die der Bot vergibt oder erwähnt, und wer was darf.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {roleField('Human-Resources-Rolle', 'humanResourcesRoleId', 'Wird in Mitteilungen zu Sanktionen als Human Resources erwähnt.')}
              {roleField('Uprank-Sperre-Rolle', 'promotionBlockRoleId', 'Agents mit aktiver Uprank-Sperre erhalten diese Rolle automatisch und verlieren sie beim Aufheben.')}
              {roleField('Beurlaubungs-Rolle', 'leaveRoleId', 'Beurlaubte Agents erhalten diese Rolle automatisch und verlieren sie beim Aufheben der Beurlaubung.')}
              {roleField('Bodycam-Katalog: Lesezugriff', 'bodycamViewerRoleId', 'Gewährt Lesezugriff auf den gesamten Bodycam-Katalog. Akten bleiben gesperrt; bestehende Ermittlungsrechte gelten weiterhin.')}
              {roleField('Clips-Channels: Analysten-Rolle', 'clipsAnalystRoleId', 'Darf in allen Clips-Channels Videos hochladen und lesen. Ohne diese Rolle werden keine Clips-Channels angelegt; bei Kündigung wird der Channel samt Videos gelöscht. Der Bot braucht „Kanäle verwalten“ und „Rollen verwalten“.')}
            </div>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-5 border-t border-[#38383a]/50 pt-5">
              <RolePickerField title="Dashboard Login-Rollen" hint="Mitglieder mit mindestens einer dieser Rollen dürfen sich anmelden. Rollen, die bei Benutzergruppen hinterlegt sind, zählen ebenfalls als Login-Rollen.">
                {renderRolePicker('authLoginRoleIds')}
              </RolePickerField>
              <RolePickerField title="Bewerberportal-Rollen" hint="Dürfen das Bewerberportal öffnen, erhalten dadurch aber keine Dashboard-Rechte.">
                {renderRolePicker('applicantRoleIds')}
              </RolePickerField>
              <RolePickerField title="Vertragseinsicht" hint="Dürfen jeden Arbeitsvertrag über dessen Link einsehen (nur lesend, ohne Dashboard-Rechte). Unterschreiben kann weiterhin nur der Agent selbst.">
                {renderRolePicker('contractAuditorRoleIds')}
              </RolePickerField>
              <RolePickerField title="Feste Mitarbeiterrollen" hint="Bekommt jeder Agent beim Sync.">
                {renderRolePicker('employeeRoleIds')}
              </RolePickerField>
              <RolePickerField title="Discord-Commands" hint="Rollen, die Discord-Commands ausführen dürfen.">
                {renderRolePicker('commandRoleIds')}
              </RolePickerField>
            </div>
          </SettingsSection>

          <SettingsSection id="mappings" icon={Tag} title="Zuordnungen" description="Welche Discord-Rolle zu welcher Benutzergruppe, welchem Rang, welcher Ausbildung und welcher Unit gehört.">
            <div className="space-y-6">
              <div>
                <p className="block text-[12.5px] font-medium text-[#d2d2d2] mb-1">Benutzergruppen zu Discord-Rollen</p>
                <p className="text-[11.5px] text-[#8e8e93] mb-3">
                  Beim Login werden alle passenden Benutzergruppen gestapelt. Eine Benutzergruppe passt, sobald ein Mitglied mindestens eine der hinterlegten Rollen hat.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {discordData?.userGroups.map((group) => {
                    const selectedRoleIds = discordForm.authGroupRoleMap[group.id] ?? []
                    const addOptions = [
                      { value: '', label: 'Rolle hinzufügen' },
                      ...(discordData?.roles
                          .filter((role) => !selectedRoleIds.includes(role.id))
                          .map((role) => ({ value: role.id, label: role.name })) || []),
                    ]

                    return (
                        <div key={group.id} className="space-y-2">
                          <Select
                              label={group.name}
                              value=""
                              onValueChange={(roleId) => addAuthGroupRole(group.id, roleId)}
                              options={addOptions}
                              size="sm"
                          />
                          <RoleChips roleIds={selectedRoleIds} roleName={roleName} onRemove={(roleId) => removeAuthGroupRole(group.id, roleId)} />
                        </div>
                    )
                  })}
                </div>
              </div>
              <div className="border-t border-[#38383a]/50 pt-5">
                <p className="block text-[12.5px] font-medium text-[#d2d2d2] mb-1">Rechte direkt an Discord-Rollen</p>
                <p className="text-[11.5px] text-[#8e8e93] mb-3">
                  Rollen mit hinterlegten Rechten zählen automatisch als Login-Rollen. Die Rechte gelten zusätzlich zu Gruppen- und Unit-Rechten und werden bei jedem Discord-Login neu übernommen.
                </p>
                <div className="max-w-md">
                  <Select
                      aria-label="Rolle für direkte Rechte hinzufügen"
                      value=""
                      onValueChange={addRolePermissionRole}
                      options={[
                        { value: '', label: 'Rolle hinzufügen' },
                        ...(discordData?.roles
                            .filter((role) => !discordForm.authRolePermissionMap[role.id])
                            .map((role) => ({ value: role.id, label: role.name })) || []),
                      ]}
                      size="sm"
                  />
                </div>
                <div className="mt-3 space-y-3">
                  {Object.keys(discordForm.authRolePermissionMap).length === 0 && (
                      <span className="text-[12px] text-[#8e8e93]">Keine Rolle konfiguriert</span>
                  )}
                  {Object.entries(discordForm.authRolePermissionMap).map(([roleId, permissions]) => (
                      <div key={roleId} className="rounded-[9px] border border-[#38383a]/60 bg-[#1c1c1e]/40 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div>
                            <p className="text-[13px] text-[#f5f5f7]">{roleName(roleId)}</p>
                            <p className="text-[11px] text-[#8e8e93]">
                              {permissions.length > 0 ? `${permissions.length} Recht(e)` : 'Noch keine Rechte – die Rolle gewährt dann keinen Zugriff'}
                            </p>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => removeRolePermissionRole(roleId)}>
                            Entfernen
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                          {PERMISSIONS.map((permission) => (
                              <Checkbox
                                  key={permission}
                                  checked={permissions.includes(permission)}
                                  onCheckedChange={(checked) => toggleRolePermission(roleId, permission, checked)}
                                  label={PERMISSION_LABELS[permission]}
                                  className="rounded-[8px] bg-[#1c1c1e]/40 border border-[#38383a]/50 px-3 py-2"
                              />
                          ))}
                        </div>
                      </div>
                  ))}
                </div>
              </div>
              <RoleMapGroup title="Rangrollen" items={(discordData?.ranks ?? []).map((rank) => ({ key: rank.id, label: rank.name }))} value={discordForm.rankRoleMap} options={roleOptions} onChange={(key, roleId) => setRoleMap('rankRoleMap', key, roleId)} />
              <RoleMapGroup title="Ausbildungsrollen" items={(discordData?.trainings ?? []).map((training) => ({ key: training.id, label: training.label }))} value={discordForm.trainingRoleMap} options={roleOptions} onChange={(key, roleId) => setRoleMap('trainingRoleMap', key, roleId)} />
              <RoleMapGroup
                  title="Individuelle Unit-Rollen"
                  hint="Für gruppierte Units pflegst du die Rangrolle direkt unter „Units verwalten“. Diese Liste bleibt für eigenständige oder ältere Units verfügbar."
                  items={(discordData?.units ?? []).map((unit) => ({ key: unit.key, label: unit.name }))}
                  value={discordForm.unitRoleMap}
                  options={roleOptions}
                  onChange={(key, roleId) => setRoleMap('unitRoleMap', key, roleId)}
              />
              <div className="border-t border-[#38383a]/50 pt-5">
                <TierManager roles={discordData?.roles ?? []} ranks={discordData?.ranks ?? []} />
              </div>
            </div>
          </SettingsSection>
        </div>

        {/* Speicherleiste */}
        <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-[#000000]/85 border-t border-[#38383a]/50 px-4 sm:px-6 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#8e8e93] truncate">
              Discord-Verbindung, Channels, Rollen und Zuordnungen werden erst nach dem Speichern aktiv.
            </p>
            <Button size="sm" onClick={saveDiscordConfig}><Save size={13} /> Discord speichern</Button>
          </div>
        </div>
      </div>
  )
}

type ChannelField =
  | 'announcementsChannelId' | 'updateChannelId' | 'sanctionsChannelId' | 'investigationsChannelId'
  | 'photoCatalogChannelId' | 'dutyStatusChannelId' | 'codenameBoardChannelId' | 'dutyAdminLogChannelId'
  | 'absenceStatusChannelId' | 'weeklyReportChannelId' | 'hirePingChannelId'
type RoleField = 'humanResourcesRoleId' | 'promotionBlockRoleId' | 'leaveRoleId' | 'bodycamViewerRoleId' | 'clipsAnalystRoleId'

function SettingsSection({ id, icon: Icon, iconClassName, title, description, action, children }: {
  id?: string
  icon: LucideIcon
  iconClassName?: string
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
      <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="glass-panel-elevated rounded-[14px] p-5 scroll-mt-section">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={id ? `${id}-title` : undefined} className="flex items-center gap-2 text-[14px] font-semibold text-[#eee]">
              <Icon size={15} className={iconClassName ?? 'text-[#d4d4d4]'} aria-hidden /> {title}
            </h2>
            {description && <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[#8e8e93]">{description}</p>}
          </div>
          {action}
        </div>
        {children}
      </section>
  )
}

function ChannelGroup({ title, single, children }: { title: string; single?: boolean; children: React.ReactNode }) {
  return (
      <div className="border-t border-[#38383a]/50 py-5 first:border-t-0 first:pt-0 last:pb-0">
        <h3 className="mb-3 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#98989d]">{title}</h3>
        <div className={cn('grid gap-x-4 gap-y-5', !single && 'sm:grid-cols-2')}>{children}</div>
      </div>
  )
}

function InlineSave({ label, value, onChange, onSave, placeholder, maxLength }: {
  label: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
  placeholder?: string
  maxLength?: number
}) {
  return (
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} />
        </div>
        <Button aria-label={`${label} speichern`} variant="secondary" size="sm" onClick={onSave}><Save size={13} /></Button>
      </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error'; children: React.ReactNode }) {
  return (
      <div
          role={tone === 'error' ? 'alert' : undefined}
          className={cn(
              'mb-4 rounded-[10px] border px-3 py-2 text-[12px]',
              tone === 'error' ? 'border-[#3b1616] bg-[#1c1111] text-[#fca5a5]' : 'border-[#3d2d12] bg-[#1d1608] text-[#c7c7cc]',
          )}
      >
        {children}
      </div>
  )
}

function RoleChips({ roleIds, roleName, onRemove }: { roleIds: string[]; roleName: (id: string) => string; onRemove: (id: string) => void }) {
  return (
      <div className="flex flex-wrap gap-2 min-h-[34px]">
        {roleIds.map((roleId) => (
            <button
                key={roleId}
                type="button"
                onClick={() => onRemove(roleId)}
                aria-label={`${roleName(roleId)} entfernen`}
                className="inline-flex min-h-[30px] items-center gap-1.5 rounded-[7px] border border-[#48484a] bg-[#1c1c1e]/70 px-2.5 py-1 text-[12px] text-[#f5f5f7] hover:border-[#d4d4d4]/50"
            >
              {roleName(roleId)}
              <X size={12} className="text-[#8e8e93]" aria-hidden />
            </button>
        ))}
        {roleIds.length === 0 && (
            <span className="text-[12px] text-[#8e8e93] py-1.5">Keine Rollen ausgewählt</span>
        )}
      </div>
  )
}

function RolePickerField({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
      <div>
        <p className="mb-1 text-[12.5px] font-medium text-[#d2d2d2]">{title}</p>
        <p className="mb-2 text-[11.5px] leading-relaxed text-[#8e8e93]">{hint}</p>
        {children}
      </div>
  )
}

function RoleMapGroup({ title, hint, items, value, options, onChange }: {
  title: string
  hint?: string
  items: { key: string; label: string }[]
  value: Record<string, string>
  options: SelectOption[]
  onChange: (key: string, roleId: string) => void
}) {
  return (
      <div className="border-t border-[#38383a]/50 pt-5">
        <p className="mb-1 text-[12.5px] font-medium text-[#d2d2d2]">{title}</p>
        {hint && <p className="mb-3 text-[11.5px] leading-relaxed text-[#8e8e93]">{hint}</p>}
        <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-3', !hint && 'mt-2')}>
          {items.map((item) => (
              <Select
                  key={item.key}
                  label={item.label}
                  value={value[item.key] || ''}
                  onValueChange={(roleId) => onChange(item.key, roleId)}
                  options={options}
                  size="sm"
              />
          ))}
        </div>
      </div>
  )
}
