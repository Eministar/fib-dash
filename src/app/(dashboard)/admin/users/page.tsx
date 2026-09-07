'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Edit, ShieldCheck, UserCog } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { formatDate } from '@/lib/utils'
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '@/lib/permissions'

interface User {
  id: string
  username: string
  displayName: string
  discordId: string | null
  discordUsername?: string | null
  avatarUrl: string | null
  groupIds: string[]
  permissions: Permission[]
  groups: { id: string; name: string }[]
  unitIds?: string[]
  units?: { id: string; name: string; key: string }[]
  createdAt: string | null
  lastLoginAt?: string | null
  discordOnly?: boolean
}

interface GroupOption {
  id: string
  name: string
  discordRoles: { id: string; name: string }[]
}

interface UnitOption {
  id: string
  name: string
  key: string
  active: boolean
  group?: { name: string } | null
}

const READ_PERMISSIONS = PERMISSIONS.filter((permission) => permission.endsWith(':view'))
const MANAGE_PERMISSIONS = PERMISSIONS.filter((permission) => !permission.endsWith(':view'))

function UserAvatar({ user }: { user: User }) {
  if (user.avatarUrl) {
    return (
      <span
        className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/20"
        style={{ backgroundImage: `url(${user.avatarUrl})` }}
        aria-label={user.displayName}
      />
    )
  }

  return (
    <div className="h-9 w-9 rounded-full bg-[#232323] flex items-center justify-center text-[12px] font-semibold text-[#d4d4d4]">
      {user.displayName.charAt(0).toUpperCase()}
    </div>
  )
}

export default function UsersPage() {
  const { data: users, loading, refetch } = useFetch<User[]>('/api/users')
  const { data: groupOptions } = useFetch<GroupOption[]>('/api/users/group-options')
  const { data: unitOptions } = useFetch<UnitOption[]>('/api/units')
  const { user: currentUser, refreshUser } = useAuth()
  const { execute } = useApi()
  const { addToast } = useToast()
  const [editUser, setEditUser] = useState<User | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [selectedDiscordRoleIds, setSelectedDiscordRoleIds] = useState<string[]>([])

  // Determine which Discord roles are relevant for the currently selected groups
  const relevantDiscordRoles = groupOptions
    ? groupOptions
        .filter((g) => selectedGroupIds.includes(g.id) && g.discordRoles.length > 0)
        .flatMap((g) => g.discordRoles)
        .filter((role, i, arr) => arr.findIndex((r) => r.id === role.id) === i)
    : []

  const openEdit = (user: User) => {
    setEditUser(user)
    setPermissions(user.permissions ?? [])
    setSelectedGroupIds(user.groups.map((g) => g.id))
    setSelectedUnitIds(user.units?.map((u) => u.id) ?? [])
    setSelectedDiscordRoleIds([])
  }

  // When selected groups change, reset Discord role selection to avoid stale state
  const selectedGroupKey = selectedGroupIds.join(',')
  useEffect(() => {
    setSelectedDiscordRoleIds([])
  }, [selectedGroupKey])

  const togglePermission = (permission: Permission, checked: boolean) => {
    setPermissions((prev) => (
      checked
        ? Array.from(new Set([...prev, permission]))
        : prev.filter((p) => p !== permission)
    ))
  }

  const toggleGroup = (groupId: string, checked: boolean) => {
    setSelectedGroupIds((prev) =>
      checked ? Array.from(new Set([...prev, groupId])) : prev.filter((id) => id !== groupId)
    )
  }

  const toggleUnit = (unitId: string, checked: boolean) => {
    setSelectedUnitIds((prev) =>
      checked ? Array.from(new Set([...prev, unitId])) : prev.filter((id) => id !== unitId)
    )
  }

  const toggleDiscordRole = (roleId: string, checked: boolean) => {
    setSelectedDiscordRoleIds((prev) =>
      checked ? Array.from(new Set([...prev, roleId])) : prev.filter((id) => id !== roleId)
    )
  }

  const savePermissions = async () => {
    if (!editUser) return
    try {
      await execute(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          permissions,
          groupIds: selectedGroupIds,
          unitIds: selectedUnitIds,
          ...(selectedDiscordRoleIds.length > 0 ? { discordRoleIds: selectedDiscordRoleIds } : {}),
        }),
      })
      addToast({ type: 'success', title: 'Benutzer aktualisiert' })
      setEditUser(null)
      if (editUser.id === currentUser?.id) await refreshUser()
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Discord-Benutzer"
        description="Discord-User mit Dashboard-Zugriff ansehen, Gruppen und direkte Rechte verwalten"
      />

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        <div className="divide-y divide-[#343434]">
          {users?.map((user, index) => (
            <motion.div
              key={user.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.02 }}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#212121] transition-colors"
            >
              <UserAvatar user={user} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13.5px] font-medium text-[#eee]">{user.displayName}</p>
                  {user.discordOnly && (
                    <span className="inline-flex items-center gap-1 rounded-[5px] border border-[#404040] bg-[#181818]/70 px-2 py-0.5 text-[10.5px] text-[#a6a6a6]">
                      <ShieldCheck size={10} /> Discord
                    </span>
                  )}
                </div>
                <p className="text-[11.5px] text-[#808080]">
                  @{user.discordUsername || user.username} · {user.groups.length ? user.groups.map((g) => g.name).join(', ') : 'Keine Gruppe'} · {user.permissions.length} direkte Rechte · Letzter Login: {formatDate(user.lastLoginAt)}
                </p>
              </div>
              <span className="text-[11.5px] font-medium text-[#888] bg-[#212121] px-2 py-[3px] rounded-[5px]">
                {user.groups.length ? `${user.groups.length} Gruppen` : 'Keine Gruppe'}
              </span>
              <button onClick={() => openEdit(user)} className="p-1.5 rounded-[6px] hover:bg-[#212121] transition-colors">
                <Edit size={13} className="text-[#808080]" />
              </button>
            </motion.div>
          ))}
          {(!users || users.length === 0) && (
            <div className="text-center py-16">
              <UserCog size={28} className="mx-auto mb-3 text-[#333]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#999]">Keine Discord-Benutzer gefunden</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Benutzer bearbeiten" size="lg">
        <div className="space-y-5">
          {editUser && (
            <div className="flex items-center gap-3 rounded-[12px] border border-[#343434]/55 bg-[#181818]/45 p-3">
              <UserAvatar user={editUser} />
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-white">{editUser.displayName}</p>
                <p className="truncate text-[11.5px] text-[#909090]">@{editUser.discordUsername || editUser.username}</p>
              </div>
            </div>
          )}

          {/* Group Assignment */}
          {groupOptions && groupOptions.length > 0 && (
            <div>
              <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Gruppen (manuell zuweisen)</p>
              <p className="text-[11px] text-[#808080] mb-2">
                Discord-Gruppen werden automatisch über Rollen gesetzt. Hier kannst du Gruppen manuell hinzufügen.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {groupOptions.map((group) => (
                  <Checkbox
                    key={group.id}
                    checked={selectedGroupIds.includes(group.id)}
                    onCheckedChange={(checked) => toggleGroup(group.id, checked)}
                    label={group.name}
                    className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Direct Unit Assignment */}
          {unitOptions && unitOptions.filter((u) => u.active).length > 0 && (
            <div>
              <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Units (direkt zuweisen)</p>
              <p className="text-[11px] text-[#808080] mb-2">
                Zusätzlich zu den Units des verknüpften Agents. Der Benutzer erhält die Rechte dieser Units.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {unitOptions.filter((u) => u.active).map((unit) => (
                  <Checkbox
                    key={unit.id}
                    checked={selectedUnitIds.includes(unit.id)}
                    onCheckedChange={(checked) => toggleUnit(unit.id, checked)}
                    label={unit.group ? `${unit.group.name} · ${unit.name}` : unit.name}
                    className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Discord Role Selection — shown when selected group has multiple roles */}
          {relevantDiscordRoles.length > 0 && editUser?.discordId && (
            <div>
              <p className="block text-[12.5px] font-medium text-[#d4d4d4] mb-2">Discord-Rollen vergeben</p>
              <p className="text-[11px] text-[#808080] mb-2">
                Die ausgewählten Gruppen haben Discord-Rollen. Wähle, welche Rollen der Benutzer in Discord erhalten soll.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {relevantDiscordRoles.map((role) => (
                  <Checkbox
                    key={role.id}
                    checked={selectedDiscordRoleIds.includes(role.id)}
                    onCheckedChange={(checked) => toggleDiscordRole(role.id, checked)}
                    label={role.name}
                    className="rounded-[8px] bg-[#181818]/40 border border-[#d4d4d4]/20 px-3 py-2"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Direct Permissions */}
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-1">Direkte Leserechte</p>
            <p className="text-[11px] text-[#808080] mb-2">Zusätzlich zu den Gruppenrechten.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {READ_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) => togglePermission(permission, checked)}
                  label={PERMISSION_LABELS[permission]}
                  className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                />
              ))}
            </div>
          </div>
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Direkte Verwaltungsrechte</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MANAGE_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  checked={permissions.includes(permission)}
                  onCheckedChange={(checked) => togglePermission(permission, checked)}
                  label={PERMISSION_LABELS[permission]}
                  className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditUser(null)}>Abbrechen</Button>
            <Button size="sm" onClick={savePermissions}>Speichern</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
