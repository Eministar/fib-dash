'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Edit, Plus, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '@/lib/permissions'

interface UserGroup {
  id: string
  name: string
  description: string | null
  permissions: Permission[]
  _count: { users: number }
}

const READ_PERMISSIONS = PERMISSIONS.filter((permission) => permission.endsWith(':view'))
const MANAGE_PERMISSIONS = PERMISSIONS.filter((permission) => !permission.endsWith(':view'))

export default function UserGroupsPage() {
  const { data: groups, loading, refetch } = useFetch<UserGroup[]>('/api/user-groups')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [modalOpen, setModalOpen] = useState(false)
  const [editGroup, setEditGroup] = useState<UserGroup | null>(null)
  const [form, setForm] = useState({ name: '', description: '', permissions: [] as Permission[] })

  const openCreate = () => {
    setEditGroup(null)
    setForm({ name: '', description: '', permissions: [] })
    setModalOpen(true)
  }

  const openEdit = (group: UserGroup) => {
    setEditGroup(group)
    setForm({
      name: group.name,
      description: group.description ?? '',
      permissions: group.permissions ?? [],
    })
    setModalOpen(true)
  }

  const togglePermission = (permission: Permission, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      permissions: checked
        ? Array.from(new Set([...prev.permissions, permission]))
        : prev.permissions.filter((p) => p !== permission),
    }))
  }

  const saveGroup = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      permissions: form.permissions,
    }
    try {
      if (editGroup) {
        await execute(`/api/user-groups/${editGroup.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        addToast({ type: 'success', title: 'Benutzergruppe aktualisiert' })
      } else {
        await execute('/api/user-groups', { method: 'POST', body: JSON.stringify(payload) })
        addToast({ type: 'success', title: 'Benutzergruppe erstellt' })
      }
      setModalOpen(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const deleteGroup = async (group: UserGroup) => {
    if (!confirm(`Benutzergruppe "${group.name}" wirklich löschen?`)) return
    try {
      await execute(`/api/user-groups/${group.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Benutzergruppe gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Benutzergruppen"
        description="Rechte bündeln und Benutzern zuweisen"
        action={<Button size="sm" onClick={openCreate}><Plus size={14} strokeWidth={2} /> Neue Gruppe</Button>}
      />

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        <div className="divide-y divide-[#343434]">
          {groups?.map((group, i) => (
            <motion.div
              key={group.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#212121] transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-[#232323] flex items-center justify-center text-[12px] font-semibold text-[#d4d4d4]">
                {group.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-medium text-[#eee]">{group.name}</p>
                <p className="text-[11.5px] text-[#808080] truncate">
                  {group.description || 'Keine Beschreibung'} · {group.permissions.length} Rechte · {group._count.users} Benutzer
                </p>
              </div>
              <div className="flex gap-0.5">
                <button onClick={() => openEdit(group)} className="p-1.5 rounded-[6px] hover:bg-[#212121] transition-colors">
                  <Edit size={13} className="text-[#808080]" />
                </button>
                <button onClick={() => deleteGroup(group)} className="p-1.5 rounded-[6px] hover:bg-[#1c1111] transition-colors">
                  <Trash2 size={13} className="text-[#808080] hover:text-[#f87171]" />
                </button>
              </div>
            </motion.div>
          ))}
          {(!groups || groups.length === 0) && (
            <div className="text-center py-16">
              <Users size={28} className="mx-auto mb-3 text-[#333]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#999]">Keine Benutzergruppen vorhanden</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editGroup ? 'Benutzergruppe bearbeiten' : 'Neue Benutzergruppe'} size="lg">
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Textarea label="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Optional" />
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Leserechte</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {READ_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  checked={form.permissions.includes(permission)}
                  onCheckedChange={(checked) => togglePermission(permission, checked)}
                  label={PERMISSION_LABELS[permission]}
                  className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                />
              ))}
            </div>
          </div>
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-2">Verwaltungsrechte</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {MANAGE_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  checked={form.permissions.includes(permission)}
                  onCheckedChange={(checked) => togglePermission(permission, checked)}
                  label={PERMISSION_LABELS[permission]}
                  className="rounded-[8px] bg-[#181818]/40 border border-[#343434]/50 px-3 py-2"
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={saveGroup} disabled={!form.name.trim()}>Speichern</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
