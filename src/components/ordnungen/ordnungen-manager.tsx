'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { Plus, FolderPlus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { ColorField } from '@/components/ui/color-field'
import { useApi } from '@/hooks/use-api'
import { useToast } from '@/components/ui/toast'
import { ORDNUNG_ICON_NAMES, ordnungIcon } from '@/lib/ordnungen-icons'
import { OrdnungEditor } from '@/components/ordnungen/ordnung-editor'
import type { OrdnungCategoryDTO, OrdnungenPayload } from '@/lib/ordnungen'

export interface OrdnungenManagerHandle {
  openEditOrdnung: (id: string) => void
  deleteOrdnung: (id: string, title: string) => void
  openEditCategory: (category: OrdnungCategoryDTO) => void
  deleteCategory: (id: string, label: string) => void
}

interface Props {
  payload: OrdnungenPayload
  canManage: boolean
  onChanged: () => void
}

const EMPTY_ORDNUNG = { title: '', description: '', buttonLabel: '', icon: 'FileText', content: '', categoryId: '' }
const EMPTY_CATEGORY = { label: '', description: '', icon: 'Library', color: '#4a8fd8' }

function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {ORDNUNG_ICON_NAMES.map((name) => {
        const Icon = ordnungIcon(name)
        const active = name === value
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className={`flex items-center justify-center h-9 rounded-[8px] border transition-colors ${active ? 'border-[#4a8fd8] bg-[#4a8fd8]/15 text-[#7fb2e8]' : 'border-[#373737]/50 text-[#919191] hover:border-[#4d4d4d]'}`}
            title={name}
          >
            <Icon size={16} strokeWidth={1.75} />
          </button>
        )
      })}
    </div>
  )
}

export const OrdnungenManager = forwardRef<OrdnungenManagerHandle, Props>(function OrdnungenManager(
  { payload, canManage, onChanged },
  ref,
) {
  const { execute } = useApi()
  const { addToast } = useToast()

  const [ordnungModalOpen, setOrdnungModalOpen] = useState(false)
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingOrdnungId, setEditingOrdnungId] = useState<string | null>(null)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [ordnungForm, setOrdnungForm] = useState({ ...EMPTY_ORDNUNG })
  const [categoryForm, setCategoryForm] = useState({ ...EMPTY_CATEGORY })
  const [saving, setSaving] = useState(false)

  function openNewOrdnung() {
    setEditingOrdnungId(null)
    setOrdnungForm({ ...EMPTY_ORDNUNG, categoryId: payload.categories[0]?.id ?? '' })
    setOrdnungModalOpen(true)
  }

  function openNewCategory() {
    setEditingCategoryId(null)
    setCategoryForm({ ...EMPTY_CATEGORY })
    setCategoryModalOpen(true)
  }

  useImperativeHandle(ref, () => ({
    async openEditOrdnung(id: string) {
      try {
        const full = (await execute(`/api/ordnungen/${id}`)) as {
          title: string; description: string; buttonLabel: string; icon: string; content: string; categoryId: string
        } | null
        if (!full) return
        setEditingOrdnungId(id)
        setOrdnungForm({
          title: full.title,
          description: full.description,
          buttonLabel: full.buttonLabel,
          icon: full.icon,
          content: full.content,
          categoryId: full.categoryId,
        })
        setOrdnungModalOpen(true)
      } catch (e) {
        addToast({ type: 'error', title: e instanceof Error ? e.message : 'Laden fehlgeschlagen' })
      }
    },
    async deleteOrdnung(id: string, title: string) {
      if (!confirm(`„${title}" wirklich löschen?`)) return
      try {
        await execute(`/api/ordnungen/${id}`, { method: 'DELETE' })
        addToast({ type: 'success', title: 'Ordnung gelöscht' })
        onChanged()
      } catch (e) {
        addToast({ type: 'error', title: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' })
      }
    },
    openEditCategory(category: OrdnungCategoryDTO) {
      setEditingCategoryId(category.id)
      setCategoryForm({
        label: category.label,
        description: category.description ?? '',
        icon: category.icon,
        color: category.color,
      })
      setCategoryModalOpen(true)
    },
    async deleteCategory(id: string, label: string) {
      if (!confirm(`Kategorie „${label}" wirklich löschen?`)) return
      try {
        await execute(`/api/ordnungen/categories/${id}`, { method: 'DELETE' })
        addToast({ type: 'success', title: 'Kategorie gelöscht' })
        onChanged()
      } catch (e) {
        addToast({ type: 'error', title: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' })
      }
    },
  }))

  async function saveOrdnung() {
    if (!ordnungForm.title.trim()) { addToast({ type: 'error', title: 'Titel fehlt' }); return }
    if (!ordnungForm.categoryId) { addToast({ type: 'error', title: 'Kategorie fehlt' }); return }
    setSaving(true)
    try {
      const url = editingOrdnungId ? `/api/ordnungen/${editingOrdnungId}` : '/api/ordnungen'
      await execute(url, { method: editingOrdnungId ? 'PUT' : 'POST', body: JSON.stringify(ordnungForm) })
      addToast({ type: 'success', title: editingOrdnungId ? 'Ordnung gespeichert' : 'Ordnung erstellt' })
      setOrdnungModalOpen(false)
      onChanged()
    } catch (e) {
      addToast({ type: 'error', title: e instanceof Error ? e.message : 'Fehler beim Speichern' })
    } finally {
      setSaving(false)
    }
  }

  async function saveCategory() {
    if (!categoryForm.label.trim()) { addToast({ type: 'error', title: 'Bezeichnung fehlt' }); return }
    setSaving(true)
    try {
      const url = editingCategoryId ? `/api/ordnungen/categories/${editingCategoryId}` : '/api/ordnungen/categories'
      await execute(url, { method: editingCategoryId ? 'PUT' : 'POST', body: JSON.stringify(categoryForm) })
      addToast({ type: 'success', title: editingCategoryId ? 'Kategorie gespeichert' : 'Kategorie erstellt' })
      setCategoryModalOpen(false)
      setCategoryForm({ ...EMPTY_CATEGORY })
      onChanged()
    } catch (e) {
      addToast({ type: 'error', title: e instanceof Error ? e.message : 'Fehler beim Speichern' })
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) return null

  const categoryOptions = payload.categories.map((c) => ({ value: c.id, label: c.label }))

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      <button
        onClick={openNewOrdnung}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[#333333] px-3 text-[12.5px] font-medium text-[#f4f4f4] hover:bg-[#414141] transition-colors"
      >
        <Plus size={15} strokeWidth={2} /> Neue Ordnung
      </button>
      <button
        onClick={openNewCategory}
        className="inline-flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[#232323] px-3 text-[12.5px] font-medium text-[#f4f4f4] hover:bg-[#333333] transition-colors"
      >
        <FolderPlus size={15} strokeWidth={2} /> Neue Kategorie
      </button>

      {/* Ordnung-Editor (Vollbild) */}
      <OrdnungEditor
        open={ordnungModalOpen}
        isEditing={!!editingOrdnungId}
        form={ordnungForm}
        onChange={(patch) => setOrdnungForm((f) => ({ ...f, ...patch }))}
        categoryOptions={categoryOptions}
        saving={saving}
        onSave={saveOrdnung}
        onClose={() => setOrdnungModalOpen(false)}
      />

      {/* Kategorie-Modal */}
      <Modal
        open={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title={editingCategoryId ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
        size="md"
      >
        <div className="space-y-3">
          <Input
            label="Bezeichnung"
            value={categoryForm.label}
            onChange={(e) => setCategoryForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="z. B. Human Resources"
          />
          <Input
            label="Beschreibung"
            value={categoryForm.description}
            onChange={(e) => setCategoryForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional"
          />
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-1.5">Icon</p>
            <IconPicker value={categoryForm.icon} onChange={(v) => setCategoryForm((f) => ({ ...f, icon: v }))} />
          </div>
          <div>
            <p className="block text-[12.5px] font-medium text-[#aeaeae] mb-1.5">Farbe</p>
            <ColorField value={categoryForm.color} onChange={(v) => setCategoryForm((f) => ({ ...f, color: v }))} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setCategoryModalOpen(false)} className="h-9 px-3 rounded-[8px] bg-[#232323] text-[12.5px] text-[#d7d7d7]">Abbrechen</button>
            <button disabled={saving} onClick={saveCategory} className="h-9 px-4 rounded-[8px] bg-[#333333] text-[12.5px] text-[#f4f4f4] disabled:opacity-50">Speichern</button>
          </div>
        </div>
      </Modal>
    </div>
  )
})
