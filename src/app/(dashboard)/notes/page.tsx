'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { StickyNote, Plus, Pin, Trash2, Edit, Globe, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { useAuth } from '@/context/auth-context'
import { formatDateTime, cn } from '@/lib/utils'
import { hasPermission } from '@/lib/permissions'

interface Note {
  id: string
  title: string | null
  content: string
  pinned: boolean
  agentId: string | null
  agent: { firstName: string; lastName: string; badgeNumber: string } | null
  author: { displayName: string } | null
  createdAt: string
  updatedAt: string
}

export default function NotesPage() {
  const { user } = useAuth()
  const canViewNotes = hasPermission(user, 'notes:view')
  const canManageNotes = hasPermission(user, 'notes:manage')
  const { data: notes, loading, refetch } = useFetch<Note[]>(canViewNotes ? '/api/notes' : null)
  const { execute } = useApi()
  const { addToast } = useToast()

  const [createModal, setCreateModal] = useState(false)
  const [editNote, setEditNote] = useState<Note | null>(null)
  const [form, setForm] = useState({ title: '', content: '', pinned: false })
  const [filter, setFilter] = useState<'all' | 'global' | 'agent'>('all')

  const filteredNotes = notes?.filter(n => {
    if (filter === 'global') return !n.agentId
    if (filter === 'agent') return !!n.agentId
    return true
  }) || []

  const handleCreate = async () => {
    try {
      await execute('/api/notes', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      addToast({ type: 'success', title: 'Notiz erstellt' })
      setCreateModal(false)
      setForm({ title: '', content: '', pinned: false })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleUpdate = async () => {
    if (!editNote) return
    try {
      await execute(`/api/notes/${editNote.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      addToast({ type: 'success', title: 'Notiz aktualisiert' })
      setEditNote(null)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await execute(`/api/notes/${id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Notiz gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleTogglePin = async (note: Note) => {
    try {
      await execute(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: !note.pinned }),
      })
      await refetch()
    } catch {
      addToast({ type: 'error', title: 'Fehler' })
    }
  }

  const startEdit = (note: Note) => {
    setForm({ title: note.title || '', content: note.content, pinned: note.pinned })
    setEditNote(note)
  }

  if (!canViewNotes) return <UnauthorizedContent />
  if (loading) return <PageLoader />

  return (
    <div>
      <PageHeader
        title="Notizen"
        description="Globale und mitarbeiterbezogene Notizen"
        action={
          canManageNotes ? (
            <Button size="sm" onClick={() => { setForm({ title: '', content: '', pinned: false }); setCreateModal(true) }}>
              <Plus size={14} strokeWidth={2} />
              Neue Notiz
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-1.5 mb-6">
        {(['all', 'global', 'agent'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3.5 py-[7px] rounded-[8px] text-[13px] font-medium transition-colors duration-100',
              filter === f
                ? 'bg-[#d4d4d4] text-[#1d1d1d]'
                : 'text-[#888] hover:text-[#eee] hover:bg-[#212121]'
            )}
          >
            {f === 'all' ? 'Alle' : f === 'global' ? 'Global' : 'Mitarbeiter'}
          </button>
        ))}
      </div>

      {filteredNotes.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredNotes.map((note, i) => (
            <motion.div
              key={note.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={cn(
                'glass-panel-elevated rounded-[14px] p-4',
                note.pinned && 'ring-1 ring-[#fbbf24]/30'
              )}
            >
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  {note.pinned && <Pin size={12} className="text-[#fbbf24]" />}
                  {note.agent ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#888] bg-[#212121] px-2 py-0.5 rounded-[5px]">
                      <User size={9} />
                      {note.agent.firstName} {note.agent.lastName}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#888] bg-[#212121] px-2 py-0.5 rounded-[5px]">
                      <Globe size={9} />
                      Global
                    </span>
                  )}
                </div>
                {canManageNotes && (
                <div className="flex gap-0.5">
                  <button onClick={() => handleTogglePin(note)} className="p-1 rounded-[6px] hover:bg-[#212121] transition-colors">
                    <Pin size={13} className={cn(note.pinned ? 'text-[#fbbf24]' : 'text-[#808080]')} />
                  </button>
                  <button onClick={() => startEdit(note)} className="p-1 rounded-[6px] hover:bg-[#212121] transition-colors">
                    <Edit size={13} className="text-[#808080]" />
                  </button>
                  <button onClick={() => handleDelete(note.id)} className="p-1 rounded-[6px] hover:bg-[#1c1111] transition-colors">
                    <Trash2 size={13} className="text-[#808080] hover:text-[#f87171]" />
                  </button>
                </div>
                )}
              </div>
              {note.title && (
                <h4 className="text-[13.5px] font-semibold text-[#eee] mb-1">{note.title}</h4>
              )}
              <p className="text-[13px] text-[#999] whitespace-pre-wrap leading-relaxed">{note.content}</p>
              <p className="text-[11px] text-[#808080] mt-3">
                {note.author?.displayName ?? 'Gelöscht'} · {formatDateTime(note.createdAt)}
              </p>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <StickyNote size={28} className="mx-auto mb-3 text-[#333]" strokeWidth={1.5} />
          <p className="text-[13px] text-[#999]">Keine Notizen vorhanden</p>
        </div>
      )}

      <Modal open={createModal} onClose={() => setCreateModal(false)} title="Neue Notiz">
        <div className="space-y-4">
          <Input label="Titel (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Inhalt" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} required />
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="rounded accent-[#d4d4d4]" />
            <span className="text-[13px] text-[#999]">Notiz anpinnen</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setCreateModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleCreate} disabled={!form.content.trim()}>Erstellen</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editNote} onClose={() => setEditNote(null)} title="Notiz bearbeiten">
        <div className="space-y-4">
          <Input label="Titel" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Textarea label="Inhalt" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={4} />
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} className="rounded accent-[#d4d4d4]" />
            <span className="text-[13px] text-[#999]">Notiz anpinnen</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setEditNote(null)}>Abbrechen</Button>
            <Button size="sm" onClick={handleUpdate}>Speichern</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
