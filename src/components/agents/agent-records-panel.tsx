'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Plus, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn, formatDateTime } from '@/lib/utils'

type RecordKind = 'POSITIVE' | 'NEGATIVE'

interface AgentRecord {
  id: string
  kind: RecordKind
  title: string
  content: string | null
  source: string
  createdAt: string
  author: string | null
}

interface AgentRecordList {
  linked?: boolean
  entries: AgentRecord[]
  positive: number
  negative: number
}

const KIND_META: Record<RecordKind, { label: string; icon: typeof ThumbsUp; text: string; tile: string; border: string }> = {
  POSITIVE: { label: 'Positiv', icon: ThumbsUp, text: 'text-[#4ade80]', tile: 'bg-[#4ade80]/10', border: 'border-l-[#4ade80]/70' },
  NEGATIVE: { label: 'Negativ', icon: ThumbsDown, text: 'text-[#f87171]', tile: 'bg-[#f87171]/10', border: 'border-l-[#f87171]/70' },
}

/**
 * Positive/negative Einträge der Personalakte. Mit `agentId` + `canManage`
 * können Einträge angelegt und gelöscht werden; ohne ist die Liste nur lesbar
 * (z. B. „Meine Einträge“ auf der Konto-Seite).
 */
export function AgentRecordsPanel({ agentId, canManage = false, title = 'Einträge', delay = 0.1 }: {
  agentId?: string
  canManage?: boolean
  title?: string
  delay?: number
}) {
  const url = agentId ? `/api/agents/${agentId}/records` : '/api/account/records'
  const { data, setData } = useFetch<AgentRecordList>(url)
  const { execute, loading } = useApi<AgentRecordList>()
  const { addToast } = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<{ kind: RecordKind; title: string; content: string }>({ kind: 'POSITIVE', title: '', content: '' })

  if (data && data.linked === false) return null
  const manage = canManage && !!agentId

  const openModal = (kind: RecordKind) => {
    setForm({ kind, title: '', content: '' })
    setModalOpen(true)
  }

  const create = async () => {
    try {
      const next = await execute(url, { method: 'POST', body: JSON.stringify(form) })
      if (next) setData(next)
      setModalOpen(false)
      addToast({ type: 'success', title: 'Eintrag gespeichert' })
    } catch (cause) {
      addToast({ type: 'error', title: 'Speichern fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  const remove = async (entry: AgentRecord) => {
    try {
      const next = await execute(`${url}/${entry.id}`, { method: 'DELETE' })
      if (next) setData(next)
      addToast({ type: 'success', title: 'Eintrag gelöscht' })
    } catch (cause) {
      addToast({ type: 'error', title: 'Löschen fehlgeschlagen', message: cause instanceof Error ? cause.message : '' })
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay }}
      className="glass-panel-elevated rounded-[14px] p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-[13.5px] font-semibold text-[#eee]">{title}</h3>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#4ade80]/10 px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-[#4ade80]" title="Positive Einträge">
            <ThumbsUp size={11} strokeWidth={2} /> {data?.positive ?? 0}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f87171]/10 px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-[#f87171]" title="Negative Einträge">
            <ThumbsDown size={11} strokeWidth={2} /> {data?.negative ?? 0}
          </span>
          {manage && (
            <button onClick={() => openModal('POSITIVE')} className="ml-1 p-1 rounded-[6px] hover:bg-[#212121] transition-colors" aria-label="Eintrag hinzufügen" title="Eintrag hinzufügen">
              <Plus size={14} className="text-[#8c8c8c]" />
            </button>
          )}
        </div>
      </div>

      {data && data.entries.length > 0 ? (
        <div className="space-y-2">
          {data.entries.map((entry) => {
            const meta = KIND_META[entry.kind]
            const Icon = meta.icon
            return (
              <div key={entry.id} className={cn('bg-[#212121] rounded-[8px] border-l-2 p-3', meta.border)}>
                <div className="flex items-start gap-2.5">
                  <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]', meta.tile, meta.text)}>
                    <Icon size={12} strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#eee]">{entry.title}</p>
                    {entry.content && <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#909090]">{entry.content}</p>}
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#8c8c8c]">
                      {entry.source !== 'manual' && <Bot size={11} strokeWidth={1.85} />}
                      {formatDateTime(entry.createdAt)} · {entry.author ?? 'Gelöscht'}
                    </p>
                  </div>
                  {manage && (
                    <button
                      type="button"
                      onClick={() => remove(entry)}
                      disabled={loading}
                      className="shrink-0 rounded-[6px] p-1 text-[#8c8c8c] transition-colors hover:bg-[#1c1111] hover:text-[#f87171]"
                      aria-label="Eintrag löschen"
                      title="Eintrag löschen"
                    >
                      <Trash2 size={13} strokeWidth={1.85} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[12.5px] text-[#8c8c8c]">{data ? 'Keine Einträge vorhanden' : 'Lädt …'}</p>
      )}

      {manage && (
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Eintrag hinzufügen">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['POSITIVE', 'NEGATIVE'] as const).map((kind) => {
                const meta = KIND_META[kind]
                const Icon = meta.icon
                const active = form.kind === kind
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setForm({ ...form, kind })}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-[10px] border px-3 py-2.5 text-[13px] font-medium transition-colors',
                      active ? cn(meta.tile, meta.text, 'border-current') : 'border-[#343434] text-[#909090] hover:bg-[#212121]',
                    )}
                    aria-pressed={active}
                  >
                    <Icon size={14} strokeWidth={2} /> {meta.label}
                  </button>
                )
              })}
            </div>
            <Input label="Titel" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={form.kind === 'POSITIVE' ? 'z. B. Hervorragende Einsatzleitung' : 'z. B. Unentschuldigtes Fehlen beim Training'} />
            <Textarea label="Beschreibung (optional)" value={form.content} rows={3} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setModalOpen(false)}>Abbrechen</Button>
              <Button size="sm" loading={loading} disabled={form.title.trim().length < 2} onClick={create}>Speichern</Button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}
