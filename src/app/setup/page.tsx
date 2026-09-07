'use client'

import Image from 'next/image'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

type Guild = {
  id: string
  name: string
  iconUrl: string | null
  owner?: boolean
  approximateMemberCount?: number
}

type DiscordRole = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
}

type DiscordChannel = {
  id: string
  name: string
  type: number
  position: number
}

type DiscordPreview = {
  bot: { id: string; username: string; displayName: string; avatarUrl: string }
  application: { id: string; name: string; iconUrl: string | null; publicKey: string }
  guilds: Guild[]
  selectedGuild: Guild | null
  roles: DiscordRole[]
  channels: DiscordChannel[]
}

type DatabaseResult = { databaseName: string; version: string; durationMs: number }

const steps = [
  { label: 'Willkommen', short: 'Start', icon: Sparkles },
  { label: 'Datenbank', short: 'Datenbank', icon: Database },
  { label: 'Discord Bot', short: 'Bot', icon: Bot },
  { label: 'Server & Zugriff', short: 'Zugriff', icon: ShieldCheck },
  { label: 'Bereit', short: 'Fertig', icon: CheckCircle2 },
]

function inputClass(valid?: boolean) {
  return [
    'h-12 w-full rounded-xl border bg-[#181818]/75 px-4 text-[13px] text-[#f4f4f4] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#666666]',
    valid === true
      ? 'border-[#34d399]/45 shadow-[0_0_0_3px_rgba(52,211,153,0.07)]'
      : 'border-[#363636] focus:border-[#d4d4d4]/55 focus:bg-[#1b1b1b] focus:shadow-[0_0_0_3px_rgba(212,212,212,0.08)]',
  ].join(' ')
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#adadad]">{children}</label>
      {hint && <span className="text-[10.5px] text-[#737373]">{hint}</span>}
    </div>
  )
}

function InlineMessage({ tone, children }: { tone: 'success' | 'error' | 'info'; children: React.ReactNode }) {
  const styles = {
    success: 'border-[#34d399]/20 bg-[#34d399]/[0.07] text-[#8ce8c5]',
    error: 'border-[#fb7185]/20 bg-[#fb7185]/[0.07] text-[#fda4af]',
    info: 'border-[#38bdf8]/20 bg-[#38bdf8]/[0.06] text-[#9bdcf8]',
  }
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' ? CircleAlert : Radio
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[12px] leading-5 ${styles[tone]}`}>
      <Icon size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  type = 'button',
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  busy?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      whileTap={disabled || busy ? undefined : { scale: 0.98 }}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#c1c1c1] to-[#a4a4a4] px-5 text-[12.5px] font-bold text-[#161616] shadow-[0_8px_24px_rgba(212,212,212,0.16),inset_0_1px_0_rgba(255,255,255,0.32)] transition-[filter,opacity] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {busy && <LoaderCircle size={15} className="animate-spin" />}
      {children}
    </motion.button>
  )
}

function SecondaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#404040] bg-[#1d1d1d]/70 px-4 text-[12.5px] font-semibold text-[#d3d3d3] transition-colors hover:border-[#37648f] hover:bg-[#272727] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </motion.button>
  )
}

export default function SetupPage() {
  const reducedMotion = useReducedMotion()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState(1)
  const [databaseUrl, setDatabaseUrl] = useState('')
  const [databaseResult, setDatabaseResult] = useState<DatabaseResult | null>(null)
  const [testedDatabaseUrl, setTestedDatabaseUrl] = useState('')
  const [botToken, setBotToken] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [showBotToken, setShowBotToken] = useState(false)
  const [showClientSecret, setShowClientSecret] = useState(false)
  const [discord, setDiscord] = useState<DiscordPreview | null>(null)
  const [testedBotToken, setTestedBotToken] = useState('')
  const [guildId, setGuildId] = useState('')
  const [adminRoleIds, setAdminRoleIds] = useState<string[]>([])
  const [siteUrl, setSiteUrl] = useState('')
  const [announcementsChannelId, setAnnouncementsChannelId] = useState('')
  const [sanctionsChannelId, setSanctionsChannelId] = useState('')
  const [busy, setBusy] = useState<'database' | 'discord' | 'guild' | 'complete' | null>(null)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)

  useEffect(() => {
    setSiteUrl(window.location.origin)
  }, [])

  const databaseValid = Boolean(databaseResult && testedDatabaseUrl === databaseUrl.trim())
  const discordValid = Boolean(discord && testedBotToken === botToken.trim())
  const selectedGuild = discord?.selectedGuild?.id === guildId
    ? discord.selectedGuild
    : discord?.guilds.find((guild) => guild.id === guildId) ?? null
  const selectedRoles = useMemo(
    () => discord?.roles.filter((role) => adminRoleIds.includes(role.id)) ?? [],
    [adminRoleIds, discord?.roles],
  )

  const canContinue = [
    true,
    databaseValid,
    discordValid && clientSecret.trim().length >= 16,
    Boolean(guildId && selectedGuild && adminRoleIds.length > 0 && /^https?:\/\//.test(siteUrl)),
    true,
  ][step]

  const goTo = (nextStep: number) => {
    setDirection(nextStep > step ? 1 : -1)
    setError('')
    setStep(Math.max(0, Math.min(steps.length - 1, nextStep)))
  }

  const parseResponse = async <T,>(response: Response): Promise<T> => {
    const payload = await response.json()
    if (!response.ok || !payload.success) throw new Error(payload.error || 'Die Anfrage ist fehlgeschlagen.')
    return payload.data as T
  }

  const testDatabase = async () => {
    setBusy('database')
    setError('')
    setDatabaseResult(null)
    try {
      const result = await parseResponse<DatabaseResult>(await fetch('/api/setup/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl }),
      }))
      setDatabaseResult(result)
      setTestedDatabaseUrl(databaseUrl.trim())
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Datenbank konnte nicht verbunden werden.')
    } finally {
      setBusy(null)
    }
  }

  const loadDiscord = async (selectedGuildId?: string) => {
    setBusy(selectedGuildId ? 'guild' : 'discord')
    setError('')
    try {
      const result = await parseResponse<DiscordPreview>(await fetch('/api/setup/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken, guildId: selectedGuildId || undefined }),
      }))
      setDiscord(result)
      setTestedBotToken(botToken.trim())
      if (!selectedGuildId && result.guilds.length === 1) {
        setGuildId(result.guilds[0].id)
        await loadDiscord(result.guilds[0].id)
        return
      }
      if (selectedGuildId) {
        setGuildId(selectedGuildId)
        setAdminRoleIds([])
        setAnnouncementsChannelId('')
        setSanctionsChannelId('')
      }
    } catch (requestError) {
      if (!selectedGuildId) {
        setDiscord(null)
        setTestedBotToken('')
      }
      setError(requestError instanceof Error ? requestError.message : 'Discord konnte nicht geladen werden.')
    } finally {
      setBusy(null)
    }
  }

  const finishSetup = async () => {
    if (!discord || !selectedGuild) return
    setBusy('complete')
    setError('')
    try {
      await parseResponse(await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseUrl,
          botToken,
          clientSecret,
          applicationId: discord.application.id,
          publicKey: discord.application.publicKey,
          guildId,
          adminRoleIds,
          siteUrl,
          announcementsChannelId,
          sanctionsChannelId,
        }),
      }))
      setCompleted(true)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Einrichtung konnte nicht abgeschlossen werden.')
    } finally {
      setBusy(null)
    }
  }

  const toggleRole = (roleId: string) => {
    setAdminRoleIds((current) => current.includes(roleId)
      ? current.filter((id) => id !== roleId)
      : [...current, roleId])
  }

  const motionVariants = {
    enter: (travel: number) => reducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: travel * 28, filter: 'blur(4px)' },
    center: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: (travel: number) => reducedMotion
      ? { opacity: 0 }
      : { opacity: 0, x: travel * -22, filter: 'blur(3px)' },
  }

  const renderStep = () => {
    if (step === 0) {
      return (
        <div className="flex min-h-[440px] flex-col justify-center py-8">
          <div className="mb-7 inline-flex h-16 w-16 items-center justify-center rounded-[20px] border border-[#d4d4d4]/25 bg-[#d4d4d4]/[0.08] text-[#c1c1c1] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
            <Sparkles size={26} strokeWidth={1.7} />
          </div>
          <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.2em] text-[#d4d4d4]">Ersteinrichtung</p>
          <h1 className="max-w-[620px] text-[32px] font-semibold leading-[1.12] tracking-[-0.035em] text-white sm:text-[40px]">
              Willkommen in deinem neuen FIB Dashboard.
          </h1>
          <p className="mt-5 max-w-[600px] text-[14px] leading-7 text-[#a3a3a3]">
            Wir verbinden jetzt Datenbank und Discord, laden deinen Bot live und richten den ersten geschützten Zugang ein. Die Zugangsdaten bleiben dabei ausschließlich auf diesem Server.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              [Database, 'Datenbank prüfen', 'Verbindung und Schema'],
              [Bot, 'Bot erkennen', 'Profil und Server live'],
              [ShieldCheck, 'Zugriff sichern', 'Admin-Rolle festlegen'],
            ].map(([Icon, title, description]) => {
              const StepIcon = Icon as typeof Database
              return (
                <div key={String(title)} className="rounded-2xl border border-[#343434]/75 bg-[#191919]/55 p-4">
                  <StepIcon size={17} className="mb-3 text-[#d4d4d4]" />
                  <p className="text-[12.5px] font-semibold text-[#efefef]">{String(title)}</p>
                  <p className="mt-1 text-[11px] text-[#767676]">{String(description)}</p>
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    if (step === 1) {
      return (
        <div className="py-3">
          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#38bdf8]/20 bg-[#38bdf8]/[0.07] text-[#7dd3fc]">
              <Database size={21} />
            </div>
            <h2 className="text-[25px] font-semibold tracking-[-0.025em] text-white">Datenbank verbinden</h2>
            <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#969696]">MySQL oder MariaDB wird geprüft. Das Schema wird erst beim finalen Abschluss eingerichtet.</p>
          </div>

          <div>
            <FieldLabel hint="MySQL / MariaDB">Datenbank-URL</FieldLabel>
            <div className="relative">
              <Database size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#737373]" />
              <input
                value={databaseUrl}
                onChange={(event) => {
                  setDatabaseUrl(event.target.value)
                  setDatabaseResult(null)
                  setError('')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && databaseUrl.trim() && !busy) void testDatabase()
                }}
                className={`${inputClass(databaseValid)} pl-11 font-mono text-[12px]`}
                placeholder="mysql://benutzer:passwort@host:3306/fib_hr"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PrimaryButton onClick={() => void testDatabase()} busy={busy === 'database'} disabled={!databaseUrl.trim()}>
              Verbindung testen
            </PrimaryButton>
            <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[#737373]"><LockKeyhole size={12} /> Wird nicht an den Browser zurückgesendet</span>
          </div>

          <div className="mt-5">
            {databaseResult && databaseValid && (
              <InlineMessage tone="success">
                <strong className="font-semibold">{databaseResult.databaseName}</strong> ist erreichbar · {databaseResult.version} · {databaseResult.durationMs} ms
              </InlineMessage>
            )}
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
          </div>
        </div>
      )
    }

    if (step === 2) {
      return (
        <div className="py-3">
          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#5865f2]/25 bg-[#5865f2]/[0.09] text-[#9aa5ff]">
              <Bot size={22} />
            </div>
            <h2 className="text-[25px] font-semibold tracking-[-0.025em] text-white">Discord Bot koppeln</h2>
            <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#969696]">Nach der Prüfung laden wir Bot-Profil, Anwendung und alle verbundenen Server automatisch.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel hint="Developer Portal → Bot">Bot-Token</FieldLabel>
              <div className="relative">
                <KeyRound size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#737373]" />
                <input
                  type={showBotToken ? 'text' : 'password'}
                  value={botToken}
                  onChange={(event) => {
                    setBotToken(event.target.value)
                    setDiscord(null)
                    setTestedBotToken('')
                    setError('')
                  }}
                  className={`${inputClass(discordValid)} pl-11 pr-12 font-mono text-[12px]`}
                  placeholder="Discord Bot-Token einfügen"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowBotToken((visible) => !visible)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#767676] transition-colors hover:bg-[#2d2d2d] hover:text-white"
                  aria-label={showBotToken ? 'Token ausblenden' : 'Token anzeigen'}
                >
                  {showBotToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <PrimaryButton onClick={() => void loadDiscord()} busy={busy === 'discord'} disabled={!botToken.trim()}>
                Bot prüfen und laden
              </PrimaryButton>
            </div>

            {discord && discordValid && (
              <div className="sm:col-span-2 flex items-center gap-4 rounded-2xl border border-[#34d399]/20 bg-[#34d399]/[0.055] p-4">
                <Image src={discord.bot.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-[15px] bg-[#242424] object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-semibold text-white">{discord.bot.displayName}</p>
                    <span className="rounded-md bg-[#5865f2]/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#a9b1ff]">Bot</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#72908a]">Verifiziert · {discord.guilds.length} Server gefunden · App {discord.application.id}</p>
                </div>
                <CheckCircle2 size={20} className="shrink-0 text-[#34d399]" />
              </div>
            )}

            <div className="sm:col-span-2">
              <FieldLabel hint="Developer Portal → OAuth2">Client Secret</FieldLabel>
              <div className="relative">
                <LockKeyhole size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#737373]" />
                <input
                  type={showClientSecret ? 'text' : 'password'}
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  className={`${inputClass(clientSecret.trim().length >= 16)} pl-11 pr-12 font-mono text-[12px]`}
                  placeholder="OAuth2 Client Secret"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowClientSecret((visible) => !visible)}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#767676] transition-colors hover:bg-[#2d2d2d] hover:text-white"
                  aria-label={showClientSecret ? 'Secret ausblenden' : 'Secret anzeigen'}
                >
                  {showClientSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {error && <InlineMessage tone="error">{error}</InlineMessage>}
            <InlineMessage tone="info">Aktiviere im Discord Developer Portal unter <strong className="font-semibold">Bot → Privileged Gateway Intents</strong> den Server Members Intent für die automatische Rollensynchronisierung.</InlineMessage>
          </div>
        </div>
      )
    }

    if (step === 3) {
      return (
        <div className="py-3">
          <div className="mb-7">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d4d4d4]/20 bg-[#d4d4d4]/[0.07] text-[#c1c1c1]">
              <ShieldCheck size={22} />
            </div>
            <h2 className="text-[25px] font-semibold tracking-[-0.025em] text-white">Server und Zugriff</h2>
            <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#969696]">Wähle den Department-Server und mindestens eine Rolle, die den ersten Vollzugriff erhält.</p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FieldLabel>{busy === 'guild' ? 'Server wird geladen …' : 'Discord-Server'}</FieldLabel>
              <div className="relative">
                <Server size={15} className="absolute left-4 top-1/2 z-10 -translate-y-1/2 text-[#737373]" />
                <select
                  value={guildId}
                  disabled={busy === 'guild'}
                  onChange={(event) => void loadDiscord(event.target.value)}
                  className={`${inputClass(Boolean(selectedGuild))} appearance-none pl-11 pr-11`}
                >
                  <option value="">Server auswählen</option>
                  {discord?.guilds.map((guild) => <option key={guild.id} value={guild.id}>{guild.name}</option>)}
                </select>
                {busy === 'guild'
                  ? <LoaderCircle size={15} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-[#d4d4d4]" />
                  : <ChevronDown size={15} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#767676]" />}
              </div>
            </div>

            {selectedGuild && discord?.roles.length ? (
              <div className="sm:col-span-2">
                <FieldLabel hint={`${adminRoleIds.length} ausgewählt`}>Administrator-Rollen</FieldLabel>
                <div className="max-h-[190px] overflow-y-auto rounded-2xl border border-[#343434] bg-[#181818]/65 p-2">
                  {discord.roles.map((role) => {
                    const active = adminRoleIds.includes(role.id)
                    const roleColor = role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#a6a6a6'
                    return (
                      <button
                        type="button"
                        key={role.id}
                        onClick={() => toggleRole(role.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active ? 'bg-[#d4d4d4]/10' : 'hover:bg-[#242424]/80'}`}
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: roleColor }} />
                        <span className={`flex-1 truncate text-[12.5px] ${active ? 'font-semibold text-white' : 'text-[#adadad]'}`}>{role.name}</span>
                        {role.managed && <span className="text-[9px] uppercase tracking-wider text-[#666666]">Bot-Rolle</span>}
                        <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${active ? 'border-[#d4d4d4] bg-[#d4d4d4] text-[#161616]' : 'border-[#454545] text-transparent'}`}>
                          <Check size={12} strokeWidth={3} />
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="sm:col-span-2">
              <FieldLabel hint="Für Discord OAuth">Öffentliche Website-URL</FieldLabel>
              <input value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} className={inputClass(/^https?:\/\//.test(siteUrl))} placeholder="https://dashboard.example.de" />
              <p className="mt-2 text-[10.5px] leading-5 text-[#717171]">OAuth Redirect: <span className="font-mono text-[#8d8d8d]">{siteUrl.replace(/\/$/, '') || 'https://…'}/api/auth/discord/callback</span></p>
            </div>

            <div>
              <FieldLabel hint="Optional">Ankündigungen</FieldLabel>
              <select value={announcementsChannelId} onChange={(event) => setAnnouncementsChannelId(event.target.value)} className={`${inputClass()} appearance-none`}>
                <option value="">Später festlegen</option>
                {discord?.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel hint="Optional">Sanktionen</FieldLabel>
              <select value={sanctionsChannelId} onChange={(event) => setSanctionsChannelId(event.target.value)} className={`${inputClass()} appearance-none`}>
                <option value="">Später festlegen</option>
                {discord?.channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="mt-5"><InlineMessage tone="error">{error}</InlineMessage></div>}
        </div>
      )
    }

    return (
      <div className="py-3">
        <div className="mb-7">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#34d399]/20 bg-[#34d399]/[0.07] text-[#5ee0b0]">
            <CheckCircle2 size={22} />
          </div>
          <h2 className="text-[25px] font-semibold tracking-[-0.025em] text-white">Bereit zum Einrichten</h2>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-[#969696]">Ein letzter Blick – danach werden Schema und geschützte Server-Konfiguration angelegt.</p>
        </div>

        <div className="space-y-3">
          {[
            { icon: Database, title: databaseResult?.databaseName || 'Datenbank', value: databaseResult?.version || 'Verbindung geprüft', tone: '#7dd3fc' },
            { icon: Bot, title: discord?.bot.displayName || 'Discord Bot', value: discord?.application.name || 'Anwendung geprüft', tone: '#a9b1ff', image: discord?.bot.avatarUrl },
            { icon: Server, title: selectedGuild?.name || 'Discord-Server', value: `${selectedRoles.map((role) => role.name).join(', ') || adminRoleIds.length + ' Admin-Rolle(n)'}`, tone: '#c1c1c1' },
            { icon: LockKeyhole, title: 'Öffentliche URL', value: siteUrl, tone: '#8ce8c5' },
          ].map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className="flex items-center gap-3 rounded-2xl border border-[#343434]/80 bg-[#191919]/60 p-3.5">
                {item.image ? (
                  <Image src={item.image} alt="" width={38} height={38} className="h-[38px] w-[38px] rounded-xl object-cover" />
                ) : (
                  <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-[#242424]" style={{ color: item.tone }}><Icon size={17} /></div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-[#f4f4f4]">{item.title}</p>
                  <p className="mt-0.5 truncate text-[10.5px] text-[#787878]">{item.value}</p>
                </div>
                <CheckCircle2 size={16} className="shrink-0 text-[#34d399]" />
              </div>
            )
          })}
        </div>

        <div className="mt-5">
          <InlineMessage tone="info">Die bestehende Datenbank wird nicht zurückgesetzt. Prisma gleicht ausschließlich das benötigte Schema ab; bei riskanten Änderungen bricht die Einrichtung ab.</InlineMessage>
        </div>
        {error && <div className="mt-3"><InlineMessage tone="error">{error}</InlineMessage></div>}
      </div>
    )
  }

  const progress = completed ? 1 : step / (steps.length - 1)

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0f0f0f] text-[#f4f4f4]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(56,189,248,0.07),transparent_27%),radial-gradient(circle_at_88%_82%,rgba(212,212,212,0.075),transparent_30%)]" />
        <div className="absolute inset-0 opacity-[0.055] [background-image:linear-gradient(rgba(255,255,255,.13)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.13)_1px,transparent_1px)] [background-size:52px_52px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" />
        <div className="absolute left-[8%] top-[12%] h-48 w-48 rounded-full border border-[#d4d4d4]/10" />
        <div className="absolute left-[8%] top-[12%] h-32 w-32 translate-x-8 translate-y-8 rounded-full border border-[#38bdf8]/10" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center p-3 sm:p-6 lg:p-10">
        <div className="grid w-full max-w-[1120px] overflow-hidden rounded-[28px] border border-white/[0.075] bg-[#161616]/88 shadow-[0_30px_100px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur-2xl lg:grid-cols-[300px_1fr]">
          <aside className="relative border-b border-[#303030] bg-[#131313]/80 p-6 lg:border-b-0 lg:border-r lg:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[15px] border border-[#d4d4d4]/25 bg-[#212121]">
                <Image src="/shield.webp" alt="FIB" width={42} height={42} className="rounded-full" priority />
              </div>
              <div>
                <p className="text-[13.5px] font-semibold text-white">FIB</p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.17em] text-[#d4d4d4]/80">System Setup</p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-4 lg:mt-12 lg:block">
              <div className="relative h-[74px] w-[74px] shrink-0 lg:h-[104px] lg:w-[104px]">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
                  <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(64,64,64,.65)" strokeWidth="5" />
                  <motion.circle
                    cx="50"
                    cy="50"
                    r="43"
                    fill="none"
                    stroke="#d4d4d4"
                    strokeLinecap="round"
                    strokeWidth="5"
                    pathLength="1"
                    strokeDasharray="1"
                    strokeDashoffset="1"
                    animate={{ strokeDashoffset: 1 - progress }}
                    transition={reducedMotion ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.45 }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-white lg:text-[19px]">{completed ? '✓' : `${step + 1}/${steps.length}`}</div>
              </div>
              <div className="min-w-0 lg:mt-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#767676]">Fortschritt</p>
                <p className="mt-1 truncate text-[13px] font-semibold text-[#ebebeb]">{completed ? 'Einsatzbereit' : steps[step].label}</p>
              </div>
            </div>

            <div className="mt-8 hidden space-y-1.5 lg:block">
              {steps.map((item, index) => {
                const Icon = item.icon
                const current = index === step && !completed
                const done = index < step || completed
                return (
                  <div key={item.label} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${current ? 'bg-[#262626]' : ''}`}>
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${done ? 'border-[#34d399]/25 bg-[#34d399]/10 text-[#5ee0b0]' : current ? 'border-[#d4d4d4]/30 bg-[#d4d4d4]/10 text-[#c1c1c1]' : 'border-[#373737] text-[#656565]'}`}>
                      {done ? <Check size={13} strokeWidth={2.7} /> : <Icon size={13} />}
                    </div>
                    <span className={`text-[11.5px] ${current ? 'font-semibold text-white' : done ? 'text-[#afafaf]' : 'text-[#686868]'}`}>{item.label}</span>
                  </div>
                )
              })}
            </div>

            <div className="absolute bottom-7 left-8 right-8 hidden rounded-xl border border-[#323232] bg-[#181818]/65 p-3 lg:block">
              <div className="flex items-center gap-2 text-[10.5px] font-medium text-[#a1a1a1]"><LockKeyhole size={13} className="text-[#d4d4d4]" /> Lokale Server-Konfiguration</div>
            </div>
          </aside>

          <section className="flex min-h-[640px] flex-col p-5 sm:p-8 lg:p-10">
            {completed ? (
              <motion.div
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-1 flex-col items-center justify-center py-10 text-center"
              >
                <div className="relative mb-7 flex h-24 w-24 items-center justify-center rounded-[30px] border border-[#34d399]/25 bg-[#34d399]/[0.08] text-[#5ee0b0] shadow-[0_0_60px_rgba(52,211,153,0.09)]">
                  <CheckCircle2 size={42} strokeWidth={1.6} />
                </div>
                <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.19em] text-[#5ee0b0]">Einrichtung abgeschlossen</p>
                <h1 className="max-w-lg text-[31px] font-semibold leading-tight tracking-[-0.035em] text-white">Das Department Dashboard ist einsatzbereit.</h1>
                <p className="mt-4 max-w-md text-[13px] leading-6 text-[#979797]">Datenbank, Discord Bot und der erste Admin-Zugang sind eingerichtet. Nach dem Login kannst du Ränge, Ausbildungen und weitere Rollen konfigurieren.</p>
                <div className="mt-8">
                  <PrimaryButton onClick={() => window.location.assign('/login')}>Zum Discord-Login <ArrowRight size={15} /></PrimaryButton>
                </div>
                <p className="mt-5 max-w-sm text-[10.5px] leading-5 text-[#696969]">Bei einem selbst betriebenen Bot-Gateway verbindet sich der Bot spätestens nach dem nächsten Prozess-Neustart dauerhaft.</p>
              </motion.div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between lg:hidden">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#757575]">{steps[step].short}</p>
                  <div className="flex gap-1.5">{steps.map((item, index) => <span key={item.label} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-6 bg-[#d4d4d4]' : index < step ? 'w-1.5 bg-[#34d399]' : 'w-1.5 bg-[#3f3f3f]'}`} />)}</div>
                </div>

                <div className="relative flex-1 overflow-hidden">
                  <AnimatePresence mode="wait" custom={direction} initial={false}>
                    <motion.div
                      key={step}
                      custom={direction}
                      variants={motionVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={reducedMotion ? { duration: 0.12 } : { type: 'spring', bounce: 0, duration: 0.38 }}
                    >
                      {renderStep()}
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="mt-7 flex items-center justify-between gap-3 border-t border-[#303030]/75 pt-5">
                  {step > 0 ? (
                    <SecondaryButton onClick={() => goTo(step - 1)} disabled={Boolean(busy)}><ArrowLeft size={14} /> Zurück</SecondaryButton>
                  ) : <span />}

                  {step < steps.length - 1 ? (
                    <PrimaryButton onClick={() => goTo(step + 1)} disabled={!canContinue || Boolean(busy)}>Weiter <ArrowRight size={14} /></PrimaryButton>
                  ) : (
                    <PrimaryButton onClick={() => void finishSetup()} busy={busy === 'complete'} disabled={!canContinue}>Dashboard einrichten <ShieldCheck size={15} /></PrimaryButton>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
