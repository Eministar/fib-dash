'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Edit, Trash2, GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Modal } from '@/components/ui/modal'
import { PageHeader } from '@/components/layout/page-header'
import { PageLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'

interface Training {
  id: string
  key: string
  label: string
  sortOrder: number
  minRankId: string | null
  minRank: Rank | null
}

interface Rank {
  id: string
  name: string
  sortOrder: number
}

interface DiscordRole {
  id: string
  name: string
}

interface DiscordConfigResponse {
  config: {
    trainingRoleMap: Record<string, string>
  }
  roles: DiscordRole[]
}

export default function TrainingsPage() {
  const { data: trainings, loading, refetch } = useFetch<Training[]>('/api/trainings')
  const { data: ranks, loading: ranksLoading } = useFetch<Rank[]>('/api/ranks')
  const { data: discordData, loading: discordLoading, refetch: refetchDiscord } = useFetch<DiscordConfigResponse>('/api/discord/config')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [modalOpen, setModalOpen] = useState(false)
  const [editTraining, setEditTraining] = useState<Training | null>(null)
  const [form, setForm] = useState({ key: '', label: '', sortOrder: 0, minRankId: '', discordRoleId: '' })

  const openCreate = () => {
    setForm({ key: '', label: '', sortOrder: (trainings?.length || 0) + 1, minRankId: '', discordRoleId: '' })
    setEditTraining(null)
    setModalOpen(true)
  }

  const openEdit = (t: Training) => {
    setForm({
      key: t.key,
      label: t.label,
      sortOrder: t.sortOrder,
      minRankId: t.minRankId ?? '',
      discordRoleId: discordData?.config.trainingRoleMap[t.id] || '',
    })
    setEditTraining(t)
    setModalOpen(true)
  }

  const saveTrainingRole = async (trainingId: string, roleId: string) => {
    const trainingRoleMap = { ...(discordData?.config.trainingRoleMap || {}) }
    if (roleId) trainingRoleMap[trainingId] = roleId
    else delete trainingRoleMap[trainingId]

    await execute('/api/discord/config', {
      method: 'POST',
      body: JSON.stringify({ trainingRoleMap }),
    })
    await refetchDiscord()
  }

  const handleSave = async () => {
    const payload = {
      key: form.key,
      label: form.label,
      sortOrder: form.sortOrder,
      minRankId: form.minRankId || null,
    }
    try {
      if (editTraining) {
        await execute(`/api/trainings/${editTraining.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        await saveTrainingRole(editTraining.id, form.discordRoleId)
        addToast({ type: 'success', title: 'Ausbildung aktualisiert' })
      } else {
        const training = await execute('/api/trainings', { method: 'POST', body: JSON.stringify(payload) }) as Training | null
        if (training) await saveTrainingRole(training.id, form.discordRoleId)
        addToast({ type: 'success', title: 'Ausbildung erstellt' })
      }
      setModalOpen(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await execute(`/api/trainings/${id}`, { method: 'DELETE' })
      await saveTrainingRole(id, '')
      addToast({ type: 'success', title: 'Ausbildung gelöscht' })
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  if (loading || ranksLoading || discordLoading) return <PageLoader />

  const roleOptions = [
    { value: '', label: 'Keine Discord-Rolle' },
    ...(discordData?.roles.map((role) => ({ value: role.id, label: role.name })) || []),
  ]
  const rankOptions = [
    { value: '', label: 'Alle Ränge' },
    ...(ranks?.map((rank) => ({ value: rank.id, label: rank.name })) || []),
  ]

  const roleName = (roleId: string | undefined) => discordData?.roles.find((role) => role.id === roleId)?.name

  return (
    <div>
      <PageHeader
        title="Ausbildungen verwalten"
        description="Ausbildungsarten erstellen und bearbeiten"
        action={<Button size="sm" onClick={openCreate}><Plus size={14} strokeWidth={2} /> Neue Ausbildung</Button>}
      />

      <div className="glass-panel-elevated rounded-[14px] overflow-hidden">
        <div className="divide-y divide-[#343434]">
          {trainings?.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#212121] transition-colors"
            >
              <span className="text-[12px] text-[#bbb] font-mono w-6 text-right">{t.sortOrder}</span>
              <div className="flex-1">
                <span className="text-[13.5px] font-medium text-[#eee]">{t.label}</span>
                <span className="text-[11px] text-[#808080] ml-2 font-mono">({t.key})</span>
                <span className="text-[11px] text-[#909090] ml-2">ab {t.minRank?.name ?? 'allen Rängen'}</span>
                {roleName(discordData?.config.trainingRoleMap[t.id]) && (
                  <span className="text-[11px] text-[#909090] ml-2">Discord: {roleName(discordData?.config.trainingRoleMap[t.id])}</span>
                )}
              </div>
              <div className="flex gap-0.5">
                <button onClick={() => openEdit(t)} className="p-1.5 rounded-[6px] hover:bg-[#212121] transition-colors">
                  <Edit size={13} className="text-[#808080]" />
                </button>
                <button onClick={() => handleDelete(t.id)} className="p-1.5 rounded-[6px] hover:bg-[#1c1111] transition-colors">
                  <Trash2 size={13} className="text-[#808080] hover:text-[#f87171]" />
                </button>
              </div>
            </motion.div>
          ))}
          {(!trainings || trainings.length === 0) && (
            <div className="text-center py-16">
              <GraduationCap size={28} className="mx-auto mb-3 text-[#333]" strokeWidth={1.5} />
              <p className="text-[13px] text-[#999]">Keine Ausbildungsarten vorhanden</p>
            </div>
          )}
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTraining ? 'Ausbildung bearbeiten' : 'Neue Ausbildung'}>
        <div className="space-y-4">
          <Input label="Label (Anzeigename)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required placeholder="z.B. Erste Hilfe" />
          <Input label="Key (intern)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required placeholder="z.B. erste_hilfe" />
          <Input label="Reihenfolge" type="number" value={String(form.sortOrder)} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} />
          <Select
            label="Mindestrang"
            value={form.minRankId}
            onValueChange={(minRankId) => setForm({ ...form, minRankId })}
            options={rankOptions}
          />
          <Select
            label="Discord-Rolle"
            value={form.discordRoleId}
            onValueChange={(discordRoleId) => setForm({ ...form, discordRoleId })}
            options={roleOptions}
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.key.trim() || !form.label.trim()}>Speichern</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
