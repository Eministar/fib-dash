'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Edit, Trash2, IdCard, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'

interface License {
  id: string
  key: string
  label: string
  description: string | null
  cooldownDays: number
  sortOrder: number
  active: boolean
  granted: number
  revoked: number
}

const EMPTY_FORM = { key: '', label: '', description: '', cooldownDays: 0, sortOrder: 0, active: true }

export default function LicensesPage() {
  const { data: licenses, loading, refetch } = useFetch<License[]>('/api/licenses')
  const { execute } = useApi()
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [modalOpen, setModalOpen] = useState(false)
  const [editLicense, setEditLicense] = useState<License | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, sortOrder: (licenses?.length || 0) + 1 })
    setEditLicense(null)
    setModalOpen(true)
  }

  const openEdit = (license: License) => {
    setForm({
      key: license.key,
      label: license.label,
      description: license.description ?? '',
      cooldownDays: license.cooldownDays,
      sortOrder: license.sortOrder,
      active: license.active,
    })
    setEditLicense(license)
    setModalOpen(true)
  }

  const handleSave = async () => {
    try {
      if (editLicense) {
        await execute(`/api/licenses/${editLicense.id}`, { method: 'PATCH', body: JSON.stringify(form) })
        addToast({ type: 'success', title: 'Lizenz aktualisiert' })
      } else {
        await execute('/api/licenses', { method: 'POST', body: JSON.stringify(form) })
        addToast({ type: 'success', title: 'Lizenz erstellt' })
      }
      setModalOpen(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDelete = async (license: License) => {
    if (!(await confirm({ title: `Lizenz „${license.label}“ löschen?`, description: 'Geht nur, solange sie noch nie vergeben wurde.', tone: 'danger' }))) return
    try {
      await execute(`/api/licenses/${license.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Lizenz gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const grantAll = async (license: License) => {
    if (!(await confirm({
      title: `„${license.label}“ an alle Agents erteilen?`,
      description: 'Alle Agents im Dienst, die diese Lizenz noch nie hatten, bekommen sie. Entzogene Lizenzen bleiben entzogen. Es wird nicht einzeln im Discord gemeldet.',
      confirmLabel: 'An alle erteilen',
    }))) return
    try {
      const result = await execute(`/api/licenses/${license.id}/grant-all`, { method: 'POST' }) as { granted: number } | null
      addToast({ type: 'success', title: result?.granted ? `An ${result.granted} Agents erteilt` : 'Alle Agents haben sie schon' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (loading) return <PageLoader withHeader />

  return (
    <div>
      <PageHeader
        title="Lizenzen verwalten"
        description="Interne Lizenzen: Befugnisse, die erteilt und bei Fehlverhalten entzogen werden"
        action={<Button size="sm" onClick={openCreate}><Plus size={14} strokeWidth={2} /> Neue Lizenz</Button>}
      />

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        <div className="divide-y divide-[#38383a]">
          {licenses?.map((license, i) => (
            <motion.div
              key={license.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className={cn('flex items-center gap-4 px-5 py-3.5 hover:bg-[#2c2c2e] transition-colors', !license.active && 'opacity-60')}
            >
              <span className="text-[12px] text-[#8e8e93] font-mono w-6 text-right">{license.sortOrder}</span>
              <div className="min-w-0 flex-1">
                <div>
                  <span className="text-[13.5px] font-medium text-[#eee]">{license.label}</span>
                  <span className="text-[11px] text-[#8e8e93] ml-2 font-mono">({license.key})</span>
                  {!license.active && <span className="text-[11px] text-[#fbbf24] ml-2">deaktiviert</span>}
                </div>
                <p className="mt-0.5 text-[11.5px] text-[#8e8e93]">
                  {license.granted} erteilt · {license.revoked} entzogen · Sperrfrist {license.cooldownDays > 0 ? `${license.cooldownDays} Tage` : 'keine'}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                {license.active && (
                  <Button size="sm" variant="ghost" onClick={() => grantAll(license)} title="Allen Agents im Dienst erteilen, die sie noch nie hatten">
                    <UsersRound size={13} strokeWidth={1.85} /> An alle erteilen
                  </Button>
                )}
                <button onClick={() => openEdit(license)} className="p-1.5 rounded-[6px] hover:bg-[#2c2c2e] transition-colors" aria-label="Bearbeiten" title="Bearbeiten">
                  <Edit size={13} className="text-[#8e8e93]" />
                </button>
                <button onClick={() => handleDelete(license)} className="p-1.5 rounded-[6px] hover:bg-[#1c1111] transition-colors" aria-label="Löschen" title="Löschen">
                  <Trash2 size={13} className="text-[#8e8e93] hover:text-[#f87171]" />
                </button>
              </div>
            </motion.div>
          ))}
          {(!licenses || licenses.length === 0) && (
            <div className="text-center py-16">
              <IdCard size={28} className="mx-auto mb-3 text-[#f5f5f7]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#8e8e93]">Keine Lizenzarten vorhanden</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editLicense ? 'Lizenz bearbeiten' : 'Neue Lizenz'}>
        <div className="space-y-4">
          <Input label="Name" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required placeholder="z.B. Fahrlizenz" />
          <Input label="Key (intern)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required placeholder="z.B. fahren" />
          <Textarea label="Beschreibung" value={form.description} rows={4} onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Wofür die Lizenz gilt, wann sie entzogen wird und wie man sie zurückbekommt" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Sperrfrist nach Entzug (Tage)" type="number" min={0} max={365} value={String(form.cooldownDays)}
              onChange={(e) => setForm({ ...form, cooldownDays: Math.max(0, parseInt(e.target.value) || 0) })} />
            <Input label="Reihenfolge" type="number" value={String(form.sortOrder)} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} />
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[#eee]">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Aktiv (deaktivierte Lizenzen erscheinen nicht mehr bei den Agents, ihre Historie bleibt)
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.key.trim() || !form.label.trim()}>Speichern</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
