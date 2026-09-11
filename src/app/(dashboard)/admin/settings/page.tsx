'use client'

import { useState, useEffect, useRef } from 'react'
import { Building2, CalendarDays, CheckCircle2, Clock, Hash, Link2, MessagesSquare, RefreshCw, Save, ShieldCheck, Tag, Terminal, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { TierManager } from '@/components/settings/tier-manager'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '@/lib/permissions'

interface DiscordRole {
  id: string
  name: string
}

interface DiscordChannel {
  id: string
  name?: string
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
    absenceStatusMessageId: string
    humanResourcesRoleId: string
    bodycamViewerRoleId: string
    hirePingChannelId: string
    promotionBlockRoleId: string
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

  const [orgName, setOrgName] = useState('FIB')
  const [badgePrefix, setBadgePrefix] = useState('')
  const [codenamePrefix, setCodenamePrefix] = useState('Agent')
  const [allowDuplicateBadgeNumbers, setAllowDuplicateBadgeNumbers] = useState(false)
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
    absenceStatusMessageId: '',
    humanResourcesRoleId: '',
    bodycamViewerRoleId: '',
    hirePingChannelId: '',
    promotionBlockRoleId: '',
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

  if (loading || discordLoading) return <PageLoader />

  const roleOptions = [
    { value: '', label: 'Keine Rolle' },
    ...(discordData?.roles.map((role) => ({ value: role.id, label: role.name })) || []),
  ]
  const channelOptions = [
    { value: '', label: 'Kein Channel' },
    ...(discordData?.channels.map((channel) => ({ value: channel.id, label: `#${channel.name || channel.id}` })) || []),
  ]
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
          <div className="flex flex-wrap gap-2 min-h-[34px]">
            {selected.map((roleId) => (
                <button
                    key={roleId}
                    type="button"
                    onClick={() => removeRole(field, roleId)}
                    className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#404040] bg-[#181818]/70 px-2.5 py-1.5 text-[12px] text-[#f4f4f4] hover:border-[#d4d4d4]/50"
                    title="Rolle entfernen"
                >
                  {roleName(roleId)}
                  <span className="text-[#909090]">×</span>
                </button>
            ))}
            {selected.length === 0 && (
                <span className="text-[12px] text-[#808080] py-1.5">Keine Rollen ausgewählt</span>
            )}
          </div>
        </div>
    )
  }

  const diag = discordData?.diagnostics
  const healthItems: { ok: boolean; label: string }[] = diag ? [
    { ok: discordData?.botConfigured ?? false, label: 'Bot-Token' },
    { ok: diag.guildConfigured, label: 'Guild-ID' },
    { ok: diag.applicationConfigured, label: 'Application-ID' },
    { ok: diag.publicKeyConfigured, label: 'Public-Key' },
    { ok: diag.announcementsChannelConfigured, label: 'Announce-Channel' },
    { ok: diag.sanctionsChannelConfigured, label: 'Sanktions-Channel' },
    { ok: diag.absenceStatusChannelConfigured, label: 'Abmeldungs-Channel' },
  ] : []

  return (
      <div className="pb-20">
        <PageHeader title="Einstellungen" description="Systemweite Konfiguration für Organisation und Discord-Bot" />

        {/* Section nav */}
        <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2.5 mb-5 backdrop-blur-md bg-[#080808]/85 border-b border-[#343434]/40">
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-4xl">
            {[
              { id: 'general', label: 'Allgemein', icon: Building2 },
              { id: 'badges', label: 'Dienstnummern', icon: Hash },
              { id: 'discord-basics', label: 'Discord', icon: MessagesSquare },
              { id: 'channels', label: 'Channels', icon: Terminal },
              { id: 'roles', label: 'Rollen', icon: ShieldCheck },
              { id: 'mappings', label: 'Mappings', icon: Tag },
            ].map((item) => (
                <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12px] font-medium text-[#aeaeae] hover:text-white hover:bg-[#232323] transition-colors whitespace-nowrap"
                >
                  <item.icon size={13} /> {item.label}
                </a>
            ))}
          </div>
        </div>

        <div className="space-y-4 max-w-4xl">
          {/* Health card */}
          {discordData && (
              <div className="glass-panel-elevated rounded-[14px] p-5">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="text-[13.5px] font-semibold text-[#eee] flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-[#22c55e]" /> System-Status
                  </h3>
                  <Button variant="secondary" size="sm" onClick={refetchDiscord}><RefreshCw size={13} /> Neu prüfen</Button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {healthItems.map((h) => (
                      <div key={h.label} className={cn('health-pill justify-start', h.ok ? 'ok' : 'warn')}>
                        {h.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {h.label}
                      </div>
                  ))}
                </div>
                {diag?.interactionEndpointUrl && (
                    <div className="mt-3 rounded-[10px] border border-[#303030] bg-[#151515] px-3 py-2 text-[11.5px] text-[#aeaeae] flex items-center gap-2">
                      <Link2 size={13} className="text-[#d4d4d4] shrink-0" />
                      <span className="truncate">Interactions Endpoint: <code className="text-[#f4f4f4]">{diag.interactionEndpointUrl}</code></span>
                    </div>
                )}
              </div>
          )}

          <div id="general" className="glass-panel-elevated rounded-[14px] p-5 scroll-mt-section">
            <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4 flex items-center gap-2">
              <Building2 size={15} className="text-[#d4d4d4]" /> Allgemein
            </h3>
            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="Organisationsname" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                </div>
                <Button variant="secondary" size="sm" onClick={() => saveSetting('orgName', orgName)}><Save size={13} /></Button>
              </div>
            </div>
          </div>

          <div id="badges" className="glass-panel-elevated rounded-[14px] p-5 scroll-mt-section">
            <h3 className="text-[13.5px] font-semibold text-[#eee] mb-4 flex items-center gap-2">
              <Hash size={15} className="text-[#d4d4d4]" /> Dienstnummern
            </h3>
            <div className="space-y-4">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input label="Decknamen-Präfix" value={codenamePrefix} onChange={(e) => setCodenamePrefix(e.target.value)} maxLength={40} placeholder="Agent" />
                </div>
                <Button aria-label="Decknamen-Präfix speichern" variant="secondary" size="sm" onClick={() => saveSetting('codenames.prefix', codenamePrefix)}><Save size={13} /></Button>
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <Input label="Dienstnummer-Prefix" value={badgePrefix} onChange={(e) => setBadgePrefix(e.target.value)} placeholder="z.B. FIB-" />
                </div>
                <Button variant="secondary" size="sm" onClick={() => saveSetting('badgePrefix', badgePrefix)}><Save size={13} /></Button>
              </div>
              <div className="rounded-[10px] border border-[#3d2d12] bg-[#1d1608]/70 p-3">
                <Checkbox
                  checked={allowDuplicateBadgeNumbers}
                  onCheckedChange={setAllowDuplicateBadgeNumbers}
                  label="Temporär doppelte Dienstnummern erlauben"
                />
                <p className="mt-2 text-[11.5px] leading-5 text-[#cacaca]">
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
            </div>
          </div>

          <div id="discord-basics" className="glass-panel-elevated rounded-[14px] p-5 scroll-mt-section">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-[13.5px] font-semibold text-[#eee] flex items-center gap-2">
                  <MessagesSquare size={15} className="text-[#d4d4d4]" /> Discord Integration
                </h3>
                <p className="text-[11.5px] text-[#909090] mt-1">
                  Bot-Token wird über die Umgebung gesetzt. Rollen, Channel und Command-Rechte werden hier gepflegt.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" size="sm" onClick={fullSync} disabled={fullSyncLoading}>
                  {fullSyncLoading ? <><RefreshCw size={13} className="animate-spin" /> Synchronisiere…</> : <><Users size={13} /> Alles synchronisieren</>}
                </Button>
                <Button variant="secondary" size="sm" onClick={refetchDiscord}><RefreshCw size={13} /> Neu laden</Button>
                <Button variant="secondary" size="sm" onClick={registerCommands}><ShieldCheck size={13} /> Commands</Button>
                <Button variant="secondary" size="sm" onClick={publishDutyEmbed}><Clock size={13} /> Dienstzeiten</Button>
                <Button variant="secondary" size="sm" onClick={publishAbsenceEmbed}><CalendarDays size={13} /> Abmeldungen</Button>
                <Button size="sm" onClick={saveDiscordConfig}><Save size={13} /> Speichern</Button>
              </div>
            </div>

            {(fullSyncProgress || fullSyncResult) && (
              <div className="mb-4 rounded-[10px] border border-[#303030] bg-[#151515] px-3 py-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12.5px] font-semibold text-[#f4f4f4]">
                      {fullSyncProgress?.message ?? fullSyncResult?.message ?? 'Full-Sync'}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[#909090]">
                      {fullSyncProgress?.current ? `Aktuell: ${fullSyncProgress.current}` : 'Kein Agent aktiv'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 text-[11px] text-[#aeaeae]">
                    <span>{fullSyncProgress?.processed ?? fullSyncResult?.total ?? 0}/{fullSyncProgress?.total ?? fullSyncResult?.total ?? 0}</span>
                    <span>{syncPercent}%</span>
                    <span>Rest: {formatSeconds(fullSyncProgress?.etaSeconds ?? null)}</span>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#232323]">
                  <div
                    className="h-full rounded-full bg-[#d4d4d4] transition-[width] duration-200"
                    style={{ width: `${fullSyncResult ? 100 : syncPercent}%` }}
                  />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[#aeaeae] sm:grid-cols-4">
                  <span>Synchronisiert: <b className="text-[#f4f4f4]">{fullSyncProgress?.synced ?? fullSyncResult?.synced ?? 0}</b></span>
                  <span>Übersprungen: <b className="text-[#f4f4f4]">{fullSyncProgress?.skipped ?? fullSyncResult?.skipped ?? 0}</b></span>
                  <span>Fehler: <b className={cn((fullSyncProgress?.failed ?? fullSyncResult?.failed ?? 0) > 0 ? 'text-[#fca5a5]' : 'text-[#f4f4f4]')}>{fullSyncProgress?.failed ?? fullSyncResult?.failed ?? 0}</b></span>
                  <span>Laufzeit: <b className="text-[#f4f4f4]">{formatSeconds(fullSyncProgress?.elapsedSeconds ?? null)}</b></span>
                </div>
              </div>
            )}

            {!discordData?.botConfigured && (
                <div className="mb-4 rounded-[10px] border border-[#3d2d12] bg-[#1d1608] px-3 py-2 text-[12px] text-[#cacaca]">
                  DISCORD_BOT_TOKEN ist nicht gesetzt. Die Oberfläche kann gespeichert werden, Discord-Rollen und Channel werden aber erst mit Bot-Token geladen.
                </div>
            )}
            {discordData && !discordData.diagnostics.guildConfigured && (
                <div className="mb-4 rounded-[10px] border border-[#3d2d12] bg-[#1d1608] px-3 py-2 text-[12px] text-[#cacaca]">
                  Guild-ID fehlt. Setze sie hier oder über DISCORD_GUILD_ID, sonst können Rollen und Commands nicht geladen werden.
                </div>
            )}
            {discordData && !discordData.diagnostics.publicKeyConfigured && (
                <div className="mb-4 rounded-[10px] border border-[#3d2d12] bg-[#1d1608] px-3 py-2 text-[12px] text-[#cacaca]">
                  DISCORD_PUBLIC_KEY fehlt. Discord-Buttons und Modals werden ohne diesen Public Key von der App abgelehnt.
                </div>
            )}
            {discordData?.diagnostics.interactionEndpointUrl && (
                <div className="mb-4 rounded-[10px] border border-[#303030] bg-[#151515] px-3 py-2 text-[12px] text-[#aeaeae]">
                  Interactions Endpoint URL in Discord: <code className="text-[#f4f4f4]">{discordData.diagnostics.interactionEndpointUrl}</code>
                </div>
            )}
            {discordData?.diagnostics.rolesError && (
                <div className="mb-4 rounded-[10px] border border-[#3b1616] bg-[#1c1111] px-3 py-2 text-[12px] text-[#fca5a5]">
                  Rollen konnten nicht geladen werden: {discordData.diagnostics.rolesError}
                </div>
            )}
            {discordData?.diagnostics.channelsError && (
                <div className="mb-4 rounded-[10px] border border-[#3b1616] bg-[#1c1111] px-3 py-2 text-[12px] text-[#fca5a5]">
                  Channel konnten nicht geladen werden: {discordData.diagnostics.channelsError}
                </div>
            )}

            <div id="channels" className="grid grid-cols-1 sm:grid-cols-2 gap-3 scroll-mt-section">
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
              <div className="sm:col-span-2">
                <Select
                    label="Ankündigungs-Channel"
                    value={discordForm.announcementsChannelId}
                    onValueChange={(announcementsChannelId) => setDiscordForm({ ...discordForm, announcementsChannelId })}
                    options={channelOptions}
                />
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Update-Channel"
                    value={discordForm.updateChannelId}
                    onValueChange={(updateChannelId) => setDiscordForm({ ...discordForm, updateChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Channel für Update-Mitteilungen. Leer lassen, um den Ankündigungs-Channel zu nutzen.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Sanktions-Channel"
                    value={discordForm.sanctionsChannelId}
                    onValueChange={(sanctionsChannelId) => setDiscordForm({ ...discordForm, sanctionsChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Channel für neue Sanktionen. Leer lassen, um den Ankündigungs-Channel zu nutzen.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Ermittlungs-Channel"
                    value={discordForm.investigationsChannelId}
                    onValueChange={(investigationsChannelId) => setDiscordForm({ ...discordForm, investigationsChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Meldungen zu Einsatzakten und neuen Bodycam-Clips. Verschlusssachen werden nie gepostet.
                  Leer lassen, um die Meldungen abzuschalten.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Neueinstellung: Channel für Kurz-Ping"
                    value={discordForm.hirePingChannelId}
                    onValueChange={(hirePingChannelId) => setDiscordForm({ ...discordForm, hirePingChannelId })}
                    options={channelOptions}
                />
                <p className="mt-1.5 text-[11px] text-[#909090]">Bei einem neu angelegten Agent wird er selbst einmal kurz erwähnt; die Nachricht wird nach etwa einer Sekunde wieder gelöscht. Ohne hinterlegte Discord-ID des Agents passiert nichts. Leer bedeutet deaktiviert.</p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Bodycam-Katalog: Discord-Rolle für Lesezugriff"
                    value={discordForm.bodycamViewerRoleId}
                    onValueChange={(bodycamViewerRoleId) => setDiscordForm({ ...discordForm, bodycamViewerRoleId })}
                    options={roleOptions}
                />
                <p className="mt-1.5 text-[11px] text-[#909090]">Gewährt angemeldeten Rollenmitgliedern Zugriff auf nicht vertrauliche Bodycam-Clips. Bestehende Ermittlungsrechte gelten weiterhin.</p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Bildkatalog-Channel"
                    value={discordForm.photoCatalogChannelId}
                    onValueChange={(photoCatalogChannelId) => setDiscordForm({ ...discordForm, photoCatalogChannelId })}
                    options={channelOptions}
                />
                <p className="mt-1.5 text-[11px] text-[#909090]">Bild-Uploads erscheinen automatisch unter Ermittlungen → Bildkatalog. Der Bot benötigt Kanalzugriff, Nachrichtenverlauf und den Message Content Intent. Leer lassen zum Abschalten; eine Umgebungsvariable hat Vorrang.</p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Decknamen-Board"
                    value={discordForm.codenameBoardChannelId}
                    onValueChange={(codenameBoardChannelId) => setDiscordForm({ ...discordForm, codenameBoardChannelId })}
                    options={channelOptions}
                />
                <p className="mt-1.5 text-[11px] text-[#909090]">Aktuelle Belegung. Leer lassen, um das Board abzuschalten. Eine gesetzte Umgebungsvariable hat Vorrang.</p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Dienstzeiten-Channel"
                    value={discordForm.dutyStatusChannelId}
                    onValueChange={(dutyStatusChannelId) => setDiscordForm({ ...discordForm, dutyStatusChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Öffentliches Panel ohne Stempelbuttons; zeigt automatisch, wer als Police online ist.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Dienstzeit-Protokoll (Admin)"
                    value={discordForm.dutyAdminLogChannelId}
                    onValueChange={(dutyAdminLogChannelId) => setDiscordForm({ ...discordForm, dutyAdminLogChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Optionaler Admin-Channel für Dienstzeit-Hinweise. Leer lassen, um den Ankündigungs-Channel zu nutzen.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Abmeldungs-Channel"
                    value={discordForm.absenceStatusChannelId}
                    onValueChange={(absenceStatusChannelId) => setDiscordForm({ ...discordForm, absenceStatusChannelId })}
                    options={channelOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Öffentliches Panel mit allen aktuell abgemeldeten Agents. Leer lassen, um den Dienstzeiten- oder Ankündigungs-Channel zu nutzen.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Human-Resources-Rolle"
                    value={discordForm.humanResourcesRoleId}
                    onValueChange={(humanResourcesRoleId) => setDiscordForm({ ...discordForm, humanResourcesRoleId })}
                    options={roleOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Diese Rolle wird in Mitteilungen zu Sanktionen als Human Resources erwähnt.
                </p>
              </div>
              <div className="sm:col-span-2">
                <Select
                    label="Uprank-Sperre-Rolle"
                    value={discordForm.promotionBlockRoleId}
                    onValueChange={(promotionBlockRoleId) => setDiscordForm({ ...discordForm, promotionBlockRoleId })}
                    options={roleOptions}
                />
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Agent mit aktiver Uprank-Sperre erhalten diese Rolle automatisch (und verlieren sie beim Aufheben).
                </p>
              </div>
            </div>

            <div id="roles" className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-5 scroll-mt-section">
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Dashboard Login-Rollen</p>
                {renderRolePicker('authLoginRoleIds')}
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Mitglieder mit mindestens einer dieser Rollen dürfen sich anmelden. Rollen, die bei Benutzergruppen hinterlegt sind, zählen ebenfalls als Login-Rollen.
                </p>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Bewerberportal-Rollen</p>
                {renderRolePicker('applicantRoleIds')}
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Mitglieder mit mindestens einer dieser Rollen dürfen das Bewerberportal öffnen, erhalten dadurch aber keine Dashboard-Rechte.
                </p>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Vertragseinsicht</p>
                {renderRolePicker('contractAuditorRoleIds')}
                <p className="text-[11px] text-[#6f6f6f] mt-1.5">
                  Mitglieder mit mindestens einer dieser Rollen dürfen jeden Arbeitsvertrag über dessen Link einsehen (nur lesend, ohne Dashboard-Rechte). Unterschreiben kann weiterhin nur der Agent selbst.
                </p>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Feste Mitarbeiterrollen</p>
                {renderRolePicker('employeeRoleIds')}
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Rollen, die Discord-Commands ausführen dürfen</p>
                {renderRolePicker('commandRoleIds')}
              </div>
            </div>

            <div id="mappings" className="mt-5 space-y-5 scroll-mt-section">
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Benutzergruppen zu Discord-Rollen</p>
                <p className="text-[11px] text-[#6f6f6f] mb-3">
                  Beim Login werden alle passenden Benutzergruppen gestapelt. Eine Benutzergruppe passt, sobald ein Mitglied mindestens eine der hinterlegten Rollen hat.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          <div className="flex flex-wrap gap-2 min-h-[34px]">
                            {selectedRoleIds.map((roleId) => (
                                <button
                                    key={roleId}
                                    type="button"
                                    onClick={() => removeAuthGroupRole(group.id, roleId)}
                                    className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#404040] bg-[#181818]/70 px-2.5 py-1.5 text-[12px] text-[#f4f4f4] hover:border-[#d4d4d4]/50"
                                    title="Rolle entfernen"
                                >
                                  {roleName(roleId)}
                                  <span className="text-[#909090]">×</span>
                                </button>
                            ))}
                            {selectedRoleIds.length === 0 && (
                                <span className="text-[12px] text-[#808080] py-1.5">Keine Rollen ausgewählt</span>
                            )}
                          </div>
                        </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Rechte direkt an Discord-Rollen</p>
                <p className="text-[11px] text-[#6f6f6f] mb-3">
                  Rollen mit hinterlegten Rechten zählen automatisch als Login-Rollen: eine separate Login-Rolle ist dann nicht nötig. Die Rechte gelten zusätzlich zu Gruppen- und Unit-Rechten und werden bei jedem Discord-Login neu übernommen.
                </p>
                <div className="max-w-md">
                  <Select
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
                      <span className="text-[12px] text-[#808080]">Keine Rolle konfiguriert</span>
                  )}
                  {Object.entries(discordForm.authRolePermissionMap).map(([roleId, permissions]) => (
                      <div key={roleId} className="rounded-[9px] border border-[#343434]/60 bg-[#181818]/40 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div>
                            <p className="text-[13px] text-[#f4f4f4]">{roleName(roleId)}</p>
                            <p className="text-[11px] text-[#6f6f6f]">
                              {permissions.length > 0 ? `${permissions.length} Recht(e)` : 'Noch keine Rechte – die Rolle gewährt dann keinen Zugriff'}
                            </p>
                          </div>
                          <button
                              type="button"
                              onClick={() => removeRolePermissionRole(roleId)}
                              className="rounded-[7px] border border-[#404040] bg-[#181818]/70 px-2.5 py-1.5 text-[12px] text-[#f4f4f4] hover:border-[#d4d4d4]/50"
                              title="Rolle entfernen"
                          >
                            Entfernen
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                          {PERMISSIONS.map((permission) => (
                              <Checkbox
                                  key={permission}
                                  checked={permissions.includes(permission)}
                                  onCheckedChange={(checked) => toggleRolePermission(roleId, permission, checked)}
                                  label={PERMISSION_LABELS[permission]}
                                  className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                              />
                          ))}
                        </div>
                      </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Rangrollen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {discordData?.ranks.map((rank) => (
                      <Select
                          key={rank.id}
                          label={rank.name}
                          value={discordForm.rankRoleMap[rank.id] || ''}
                          onValueChange={(roleId) => setRoleMap('rankRoleMap', rank.id, roleId)}
                          options={roleOptions}
                          size="sm"
                      />
                  ))}
                </div>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Ausbildungsrollen</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {discordData?.trainings.map((training) => (
                      <Select
                          key={training.id}
                          label={training.label}
                          value={discordForm.trainingRoleMap[training.id] || ''}
                          onValueChange={(roleId) => setRoleMap('trainingRoleMap', training.id, roleId)}
                          options={roleOptions}
                          size="sm"
                      />
                  ))}
                </div>
              </div>
              <div>
                <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Individuelle Unit-Rollen</p>
                <p className="mb-3 text-[11px] leading-5 text-[#6e6e6e]">
                  Für gruppierte Units pflegst du die Rangrolle direkt unter „Units verwalten“. Diese Liste bleibt für eigenständige oder ältere Units verfügbar.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {discordData?.units.map((unit) => (
                      <Select
                          key={unit.key}
                          label={unit.name}
                          value={discordForm.unitRoleMap[unit.key] || ''}
                          onValueChange={(roleId) => setRoleMap('unitRoleMap', unit.key, roleId)}
                          options={roleOptions}
                          size="sm"
                      />
                  ))}
                </div>
              </div>
              <div className="border-t border-[#343434]/40 pt-5">
                <TierManager roles={discordData?.roles ?? []} ranks={discordData?.ranks ?? []} />
              </div>
            </div>
          </div>

        </div>

        {/* Sticky save bar */}
        <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-[#080808]/85 border-t border-[#343434]/50 px-4 sm:px-6 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <p className="text-[12px] text-[#868686] truncate">
              Discord-Konfiguration · Änderungen werden erst nach Speichern aktiv
            </p>
            <Button size="sm" onClick={saveDiscordConfig}><Save size={13} /> Discord speichern</Button>
          </div>
        </div>
      </div>
  )
}
