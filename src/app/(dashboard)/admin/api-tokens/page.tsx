'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, KeyRound, Plus, RefreshCw, ShieldOff, Trash2, Eye, EyeOff, Activity, Infinity as InfinityIcon, User as UserIcon, UserCog, Lock, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { PERMISSIONS, PERMISSION_LABELS, type Permission, hasAnyPermission } from '@/lib/permissions'
import { useAuth } from '@/context/auth-context'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface ApiToken {
  id: string
  name: string
  prefix: string
  scopes: Permission[]
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  usageCount: number
  createdAt: string
}

interface TokenListResponse {
  maxPerUser: number | null
  tokens: ApiToken[]
}

interface UserOption {
  id: string
  username: string
  displayName: string
  discordId: string | null
  avatarUrl: string | null
}

interface CreateResponse extends ApiToken {
  plaintext: string
  maxPerUser: number | null
  currentCount: number
  ownerUserId: string
  ownerDisplayName: string | null
}

const READ_PERMISSIONS = PERMISSIONS.filter((p) => p.endsWith(':view'))
const MANAGE_PERMISSIONS = PERMISSIONS.filter((p) => !p.endsWith(':view'))

export default function ApiTokensPage() {
  const { user } = useAuth()
  const { data, loading, refetch } = useFetch<TokenListResponse>('/api/api-tokens')
  const createApi = useApi<CreateResponse>()
  const revokeApi = useApi()
  const deleteApi = useApi()
  const usersApi = useApi<UserOption[]>()
  const settingsApi = useApi<{ maxPerUser: number | null }>()
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [createOpen, setCreateOpen] = useState(false)
  const [detailToken, setDetailToken] = useState<ApiToken | null>(null)
  const [createdToken, setCreatedToken] = useState<CreateResponse | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [limitOpen, setLimitOpen] = useState(false)

  const [form, setForm] = useState({
    name: '',
    permissionMode: 'auto' as 'auto' | 'custom',
    scopes: [] as Permission[],
    expiresInDays: 0,
    assignToUserId: '' as string, // '' = self
  })

  const [availableUsers, setAvailableUsers] = useState<UserOption[]>([])

  const isAdmin = hasAnyPermission(user, ['users:manage'])
  const tokens = data?.tokens ?? []
  const maxPerUser = data?.maxPerUser ?? null

  const userPermissionSet = useMemo(() => new Set(user?.permissions ?? []), [user])

  // Load user list when admin opens create modal
  useEffect(() => {
    if (createOpen && isAdmin && availableUsers.length === 0) {
      usersApi.execute('/api/users').then((users) => {
        if (users) setAvailableUsers(users.filter((u) => !u.id.startsWith('discord:') || true))
      }).catch(() => {})
    }
  }, [createOpen, isAdmin, availableUsers.length, usersApi])

  useEffect(() => {
    if (createdToken) setRevealed(true)
  }, [createdToken])

  const openCreate = () => {
    setForm({ name: '', permissionMode: 'auto', scopes: [], expiresInDays: 0, assignToUserId: '' })
    setCreateOpen(true)
  }

  const toggleScope = (perm: Permission, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      scopes: checked
        ? Array.from(new Set([...prev.scopes, perm]))
        : prev.scopes.filter((p) => p !== perm),
    }))
  }

  const submit = async () => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      permissionMode: form.permissionMode,
      scopes: form.permissionMode === 'auto' ? [] : form.scopes,
    }
    if (form.expiresInDays > 0) {
      payload.expiresAt = new Date(Date.now() + form.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    }
    if (isAdmin && form.assignToUserId) {
      payload.userId = form.assignToUserId
    }
    try {
      const result = await createApi.execute('/api/api-tokens', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (result) setCreatedToken(result)
      setCreateOpen(false)
      await refetch()
      addToast({ type: 'success', title: 'Token erstellt', message: 'Kopiere ihn jetzt — er wird nie wieder angezeigt.' })
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const revoke = async (token: ApiToken) => {
    if (!(await confirm({ title: `Token „${token.name}“ widerrufen?`, description: 'Bestehende Aufrufe mit diesem Token werden sofort abgelehnt.', confirmLabel: 'Widerrufen', tone: 'danger' }))) return
    try {
      await revokeApi.execute(`/api/api-tokens/${token.id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'Vom Benutzer widerrufen' }) })
      addToast({ type: 'success', title: 'Token widerrufen' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const hardDelete = async (token: ApiToken) => {
    if (!(await confirm({ title: `Token „${token.name}“ endgültig löschen?`, description: 'Der Token und alle zugehörigen Usage-Logs werden entfernt. Das lässt sich nicht rückgängig machen.', confirmLabel: 'Endgültig löschen', tone: 'danger', requireText: token.name }))) return
    try {
      await deleteApi.execute(`/api/api-tokens/${token.id}?hard=1`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Token gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      addToast({ type: 'success', title: 'Kopiert', message: label })
    } catch {
      addToast({ type: 'error', title: 'Kopieren fehlgeschlagen' })
    }
  }

  if (loading) return <PageLoader withHeader />

  const activeCount = tokens.filter((t) => !t.revokedAt).length
  const limitDisplay = maxPerUser === null ? <InfinityIcon size={11} className="inline" /> : `${activeCount} / ${maxPerUser}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="API-Tokens"
        description="Programmatischer Zugriff auf das Dashboard via Bearer-Token"
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} strokeWidth={2} /> Neuer Token
          </Button>
        }
      />

      {/* Limit-Banner */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[10px] bg-gradient-to-r from-[#1c1c1c]/60 via-[#1c1c1c]/40 to-[#1c1c1c]/60 border border-accent/15 px-4 py-3 flex items-center gap-3"
      >
        <div className="h-9 w-9 rounded-[8px] bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center text-accent">
          <KeyRound size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] text-white/90 font-medium">
            Token-Limit: <span className="text-accent font-mono">{limitDisplay}</span>
            <span className="text-[#909090] font-normal"> aktive Tokens</span>
          </p>
          <p className="text-[11px] text-[#909090] mt-0.5">
            {maxPerUser === null
              ? 'Unbegrenzt — du kannst beliebig viele Tokens anlegen.'
              : `Widerrufe einen Token, um Platz für einen neuen zu schaffen, oder passe das Limit an.`}
          </p>
        </div>
        {user?.groups?.some((g) => g.name.toLowerCase() === 'admin') && (
          <Button variant="secondary" size="sm" onClick={() => setLimitOpen(true)}>
            <Settings size={12} /> Anpassen
          </Button>
        )}
      </motion.div>

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        <div className="divide-y divide-line">
          {tokens?.map((token, i) => (
            <motion.div
              key={token.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#212121] transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-surface-raised flex items-center justify-center text-accent">
                <KeyRound size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[13.5px] font-medium text-[#eee]">{token.name}</p>
                  <code className="text-[11px] font-mono text-accent/70">{token.prefix}…</code>
                  {token.revokedAt && <RevokedBadge />}
                  {!token.revokedAt && token.expiresAt && new Date(token.expiresAt) < new Date() && (
                    <ExpiredBadge />
                  )}
                </div>
                <p className="text-[11.5px] text-fg-subtle">
                  {token.scopes.length === 0 ? 'Auto Perm' : `${token.scopes.length} Scopes`} ·
                  {' '}
                  {token.usageCount} Aufrufe · {token.lastUsedAt
                    ? `Zuletzt ${format(new Date(token.lastUsedAt), 'dd.MM.yyyy HH:mm', { locale: de })}`
                    : 'Noch nie benutzt'}
                  {token.expiresAt && !token.revokedAt && (
                    <> · Läuft ab {format(new Date(token.expiresAt), 'dd.MM.yyyy', { locale: de })}</>
                  )}
                </p>
              </div>
              <div className="flex gap-0.5">
                <button
                  onClick={() => setDetailToken(token)}
                  className="p-1.5 rounded-[6px] hover:bg-[#212121] transition-colors"
                  title="Details"
                >
                  <Activity size={13} className="text-fg-subtle" />
                </button>
                {!token.revokedAt && (
                  <button
                    onClick={() => revoke(token)}
                    className="p-1.5 rounded-[6px] hover:bg-[#1c1111] transition-colors"
                    title="Widerrufen"
                  >
                    <ShieldOff size={13} className="text-fg-subtle hover:text-[#fbbf24]" />
                  </button>
                )}
                <button
                  onClick={() => hardDelete(token)}
                  className="p-1.5 rounded-[6px] hover:bg-[#1c1111] transition-colors"
                  title="Endgültig löschen"
                >
                  <Trash2 size={13} className="text-fg-subtle hover:text-[#f87171]" />
                </button>
              </div>
            </motion.div>
          ))}
          {(!tokens || tokens.length === 0) && (
            <div className="text-center py-16">
              <KeyRound size={28} className="mx-auto mb-3 text-fg" strokeWidth={1.5} />
              <p className="text-[13px] text-[#909090]">Noch keine API-Tokens vorhanden</p>
              <p className="text-[11.5px] text-fg-subtle mt-1">Erstelle deinen ersten Token, um die API programmatisch zu nutzen.</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neuen API-Token erstellen" size="lg">
        <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="z. B. Discord-Bot / FiveM-Script / CI-Pipeline"
            required
          />

          {/* User assignment — admin only */}
          {isAdmin && (
            <div>
              <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2 flex items-center gap-1.5">
                <UserCog size={12} /> Inhaber (User zuweisen)
              </label>
              <UserPicker
                value={form.assignToUserId || user?.id || ''}
                onChange={(id) => setForm({ ...form, assignToUserId: id })}
                users={availableUsers}
                selfId={user?.id}
                selfName={user?.displayName ?? 'Ich'}
              />
              <p className="text-[11px] text-fg-subtle mt-1.5">
                Standardmäßig erhältst du den Token. Als Administrator kannst du ihn auch für andere Benutzer anlegen.
              </p>
            </div>
          )}

          <div>
            <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Ablauf</label>
            <div className="flex gap-2">
              {[
                { v: 0, l: 'Nie' },
                { v: 30, l: '30 Tage' },
                { v: 90, l: '90 Tage' },
                { v: 365, l: '1 Jahr' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setForm({ ...form, expiresInDays: opt.v })}
                  className={cn(
                    'flex-1 text-[12px] py-2 rounded-[8px] border transition-colors',
                    form.expiresInDays === opt.v
                      ? 'bg-accent/10 border-accent/50 text-accent'
                      : 'bg-surface-sunken/40 border-line/50 text-[#aeaeae] hover:border-accent/30',
                  )}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Berechtigungsmodus</label>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, permissionMode: 'auto', scopes: [] }))}
                className={cn(
                  'p-3 rounded-[8px] border text-left transition-colors',
                  form.permissionMode === 'auto'
                    ? 'bg-accent/10 border-accent/50 text-accent'
                    : 'bg-surface-sunken/40 border-line/50 text-[#aeaeae] hover:border-accent/30',
                )}
              >
                <p className="text-[12.5px] font-semibold">Auto Perm</p>
                <p className="text-[11px] text-[#909090] mt-0.5">Rechte automatisch vom Inhaber übernehmen</p>
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, permissionMode: 'custom' }))}
                className={cn(
                  'p-3 rounded-[8px] border text-left transition-colors',
                  form.permissionMode === 'custom'
                    ? 'bg-accent/10 border-accent/50 text-accent'
                    : 'bg-surface-sunken/40 border-line/50 text-[#aeaeae] hover:border-accent/30',
                )}
              >
                <p className="text-[12.5px] font-semibold">Eigene Scopes</p>
                <p className="text-[11px] text-[#909090] mt-0.5">Token auf ausgewählte Rechte begrenzen</p>
              </button>
            </div>
          </div>
          {form.permissionMode === 'custom' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[12.5px] font-medium text-[#aeaeae]">
                Scopes ({form.scopes.length} ausgewählt)
              </label>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, scopes: p.scopes.length === userPermissionSet.size ? [] : [...userPermissionSet] as Permission[] }))}
                className="text-[11px] text-accent hover:underline"
              >
                {form.scopes.length === userPermissionSet.size ? 'Keine' : 'Alle eigenen Rechte'}
              </button>
            </div>
            <p className="text-[11px] text-fg-subtle mb-3">
              Token-Scopes sind immer eine Teilmenge der Inhaber-Rechte.
            </p>
            <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
              <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">Leserechte</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {READ_PERMISSIONS.filter((p) => userPermissionSet.has(p)).map((p) => (
                  <Checkbox
                    key={p}
                    checked={form.scopes.includes(p)}
                    onCheckedChange={(c) => toggleScope(p, c)}
                    label={PERMISSION_LABELS[p]}
                    className="rounded-[8px] bg-surface-sunken/40 border border-line/50 px-2.5 py-1.5 text-[11.5px]"
                  />
                ))}
              </div>
              <p className="text-[11px] font-semibold text-accent uppercase tracking-wider mt-3">Schreibrechte</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {MANAGE_PERMISSIONS.filter((p) => userPermissionSet.has(p)).map((p) => (
                  <Checkbox
                    key={p}
                    checked={form.scopes.includes(p)}
                    onCheckedChange={(c) => toggleScope(p, c)}
                    label={PERMISSION_LABELS[p]}
                    className="rounded-[8px] bg-surface-sunken/40 border border-line/50 px-2.5 py-1.5 text-[11.5px]"
                  />
                ))}
              </div>
            </div>
          </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Abbrechen</Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={!form.name.trim() || (form.permissionMode === 'custom' && form.scopes.length === 0)}
            >
              Token erstellen
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Token — One-time display */}
      <Modal
        open={!!createdToken}
        onClose={() => setCreatedToken(null)}
        title="Dein neuer API-Token"
        size="lg"
      >
        {createdToken && (
          <div className="space-y-4">
            <div className="rounded-[10px] bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-[12.5px] text-amber-200">
              <strong>Wichtig:</strong> Das ist die einzige Gelegenheit, den Klartext-Token zu sehen oder zu kopieren.
              Speichere ihn jetzt sicher ab (z. B. in einem Secrets-Manager). Du kannst ihn später nicht wiederherstellen.
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Name</label>
              <p className="text-[13px] text-[#eee]">{createdToken.name}</p>
            </div>
            {createdToken.ownerDisplayName && createdToken.ownerUserId !== user?.id && (
              <div>
                <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2 flex items-center gap-1.5">
                  <UserIcon size={11} /> Inhaber
                </label>
                <p className="text-[13px] text-[#eee]">{createdToken.ownerDisplayName}</p>
              </div>
            )}
            <div>
              <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Token</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2.5 rounded-[8px] bg-canvas border border-line text-[12px] font-mono text-accent break-all">
                  {revealed ? createdToken.plaintext : createdToken.plaintext.replace(/[a-zA-Z0-9]/g, '•')}
                </code>
                <button
                  onClick={() => setRevealed((v) => !v)}
                  className="p-2 rounded-[8px] bg-surface-sunken/60 border border-line text-[#aeaeae] hover:text-accent"
                  title={revealed ? 'Verbergen' : 'Anzeigen'}
                >
                  {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={() => copy(createdToken.plaintext, 'Token kopiert')}
                  className="p-2 rounded-[8px] bg-surface-sunken/60 border border-line text-[#aeaeae] hover:text-accent"
                  title="Kopieren"
                >
                  <Copy size={14} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Beispiel</label>
              <pre className="px-3 py-2.5 rounded-[8px] bg-canvas border border-line text-[11.5px] font-mono text-[#aeaeae] overflow-x-auto">
{`curl https://deine-domain/api/agents \\
  -H "Authorization: Bearer \${FIB_TOKEN}"`}
              </pre>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCreatedToken(null)}>Verstanden</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Token Detail */}
      <TokenDetailModal token={detailToken} onClose={() => setDetailToken(null)} />

      {/* Limit config (admin) */}
      <LimitConfigModal
        open={limitOpen}
        onClose={() => setLimitOpen(false)}
        current={maxPerUser}
        onSave={async (value) => {
          try {
            await settingsApi.execute('/api/api-tokens/settings', {
              method: 'PATCH',
              body: JSON.stringify({ maxPerUser: value }),
            })
            await refetch()
            addToast({ type: 'success', title: 'Limit aktualisiert' })
            setLimitOpen(false)
          } catch (err) {
            addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
          }
        }}
      />
    </div>
  )
}

function LimitConfigModal({
  open,
  onClose,
  current,
  onSave,
}: {
  open: boolean
  onClose: () => void
  current: number | null
  onSave: (value: number | 'unlimited') => Promise<void>
}) {
  const [mode, setMode] = useState<'unlimited' | 'limited'>(current === null ? 'unlimited' : 'limited')
  const [value, setValue] = useState<string>(current === null ? '10' : String(current))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(current === null ? 'unlimited' : 'limited')
      setValue(current === null ? '10' : String(current))
    }
  }, [open, current])

  return (
    <Modal open={open} onClose={onClose} title="Token-Limit anpassen" size="md">
      <div className="space-y-4">
        <p className="text-[12.5px] text-[#aeaeae] leading-relaxed">
          Lege fest, wie viele aktive API-Tokens ein Benutzer maximal besitzen darf.
          Auf <strong className="text-white">unbegrenzt</strong> setzen, wenn du keine Obergrenze willst.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('unlimited')}
            className={cn(
              'flex items-center gap-2 p-3 rounded-[8px] border transition-colors text-left',
              mode === 'unlimited'
                ? 'bg-accent/10 border-accent/50 text-accent'
                : 'bg-surface-sunken/40 border-line/50 text-[#aeaeae] hover:border-accent/30',
            )}
          >
            <InfinityIcon size={16} />
            <div>
              <p className="text-[12.5px] font-semibold">Unbegrenzt</p>
              <p className="text-[11px] text-[#909090] mt-0.5">Keine Obergrenze</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setMode('limited')}
            className={cn(
              'flex items-center gap-2 p-3 rounded-[8px] border transition-colors text-left',
              mode === 'limited'
                ? 'bg-accent/10 border-accent/50 text-accent'
                : 'bg-surface-sunken/40 border-line/50 text-[#aeaeae] hover:border-accent/30',
            )}
          >
            <Lock size={16} />
            <div>
              <p className="text-[12.5px] font-semibold">Begrenzt</p>
              <p className="text-[11px] text-[#909090] mt-0.5">Max. Anzahl festlegen</p>
            </div>
          </button>
        </div>
        {mode === 'limited' && (
          <Input
            label="Max. Anzahl pro Benutzer"
            type="number"
            min={1}
            max={1000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose}>Abbrechen</Button>
          <Button
            size="sm"
            loading={saving}
            onClick={async () => {
              setSaving(true)
              try {
                if (mode === 'unlimited') {
                  await onSave('unlimited')
                } else {
                  const n = Number.parseInt(value, 10)
                  if (!Number.isFinite(n) || n < 1) return
                  await onSave(n)
                }
              } finally {
                setSaving(false)
              }
            }}
          >
            Speichern
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function UserPicker({
  value,
  onChange,
  users,
  selfId,
  selfName,
}: {
  value: string
  onChange: (id: string) => void
  users: UserOption[]
  selfId: string | undefined
  selfName: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[8px] bg-canvas border border-line text-[12.5px] text-fg focus:outline-none focus:border-accent/40 appearance-none cursor-pointer"
      >
        {selfId && <option value={selfId}>👤 {selfName} (ich)</option>}
        {users
          .filter((u) => u.id !== selfId)
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} (@{u.username})
            </option>
          ))}
      </select>
      <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-fg-subtle">▾</div>
    </div>
  )
}

function RevokedBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-500/10 text-red-300 border border-red-500/30">
      <ShieldOff size={9} /> widerrufen
    </span>
  )
}

function ExpiredBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30">
      abgelaufen
    </span>
  )
}

function TokenDetailModal({ token, onClose }: { token: ApiToken | null; onClose: () => void }) {
  const detailApi = useApi<{ recentUsage: { method: string; path: string; statusCode: number; durationMs: number; ip: string | null; createdAt: string }[] }>()
  const [details, setDetails] = useState<{
    recentUsage: { method: string; path: string; statusCode: number; durationMs: number; ip: string | null; createdAt: string }[]
  } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) {
      setDetails(null)
      return
    }
    setLoading(true)
    detailApi.execute(`/api/api-tokens/${token.id}`)
      .then((d) => setDetails(d))
      .catch(() => setDetails(null))
      .finally(() => setLoading(false))
  }, [token, detailApi])

  return (
    <Modal open={!!token} onClose={onClose} title={token?.name ?? 'Token-Details'} size="lg">
      {token && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <Field label="Prefix" value={token.prefix + '…'} mono />
            <Field label="Erstellt" value={format(new Date(token.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })} />
            <Field label="Aufrufe" value={token.usageCount.toString()} />
            <Field
              label="Zuletzt benutzt"
              value={token.lastUsedAt ? format(new Date(token.lastUsedAt), 'dd.MM.yyyy HH:mm:ss', { locale: de }) : '—'}
            />
            <Field
              label="Läuft ab"
              value={token.expiresAt ? format(new Date(token.expiresAt), 'dd.MM.yyyy HH:mm', { locale: de }) : 'nie'}
            />
            <Field label="Scopes" value={token.scopes.length === 0 ? 'Auto Perm' : `${token.scopes.length} Scopes`} />
          </div>
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Letzte Aufrufe</p>
            <div className="rounded-[10px] border border-line overflow-hidden">
              {loading && <div className="p-4 text-center text-[12px] text-fg-subtle"><RefreshCw size={12} className="inline animate-spin" /> lade…</div>}
              {!loading && details && details.recentUsage.length === 0 && (
                <div className="p-4 text-center text-[12px] text-fg-subtle">Noch keine Aufrufe</div>
              )}
              {!loading && details && details.recentUsage.length > 0 && (
                <div className="divide-y divide-line/60 max-h-[300px] overflow-y-auto">
                  {details.recentUsage.map((u, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 text-[11.5px]">
                      <span className={cn(
                        'font-mono font-semibold w-12 text-center rounded px-1 py-0.5 text-[11px]',
                        u.method === 'GET' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300',
                      )}>
                        {u.method}
                      </span>
                      <code className="flex-1 font-mono text-accent truncate">{u.path}</code>
                      <span className={cn(
                        'font-mono text-[11px] w-9 text-right',
                        u.statusCode >= 500 ? 'text-red-300' : u.statusCode >= 400 ? 'text-amber-300' : 'text-emerald-300',
                      )}>
                        {u.statusCode}
                      </span>
                      <span className="font-mono text-fg-subtle w-14 text-right">{u.durationMs}ms</span>
                      <span className="text-fg-subtle w-24 text-right">
                        {format(new Date(u.createdAt), 'dd.MM. HH:mm:ss', { locale: de })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[8px] bg-surface-sunken/40 border border-line/50 px-3 py-2">
      <p className="text-[11px] text-fg-subtle uppercase tracking-wider">{label}</p>
      <p className={cn('text-[12.5px] text-[#eee] mt-0.5', mono && 'font-mono text-accent/80')}>{value}</p>
    </div>
  )
}
