'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Link2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { LspdOfficerPicker } from '@/components/lspd/lspd-officer-picker'
import { useApi } from '@/hooks/use-api'
import { QC_SHARE_SCOPE_LABELS, type QcShareScope } from '@/lib/quality-checks'
import type { LspdOfficer } from '@/lib/lspd-officers'

/** Kontrolle beginnen: Beamten aus dem LSPD-Panel wählen, optional Ort. */
export function StartCheckDialog({
  open,
  onClose,
  initialOfficer = null,
}: {
  open: boolean
  onClose: () => void
  initialOfficer?: LspdOfficer | null
}) {
  const router = useRouter()
  const { execute, loading } = useApi<{ id: string }>()
  const [officer, setOfficer] = useState<LspdOfficer | null>(initialOfficer)
  const [location, setLocation] = useState('')
  const [failure, setFailure] = useState('')

  const start = async () => {
    if (!officer) return
    setFailure('')
    try {
      const check = await execute('/api/quality-checks', {
        method: 'POST',
        body: JSON.stringify({ lspdOfficerId: officer.id, location: location.trim() || undefined }),
      })
      if (check) router.push(`/quality-checks/${check.id}`)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Start fehlgeschlagen')
    }
  }

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      title="Qualitätskontrolle beginnen"
      description="Beamten wählen, mitfahren, unterwegs protokollieren."
      size="lg"
    >
      <div className="space-y-4">
        <LspdOfficerPicker value={officer} onChange={setOfficer} />
        <Input label="Ort / Streifengebiet (optional)" maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} />
        {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={loading}>Abbrechen</Button>
          <Button onClick={() => void start()} loading={loading} disabled={!officer}>Kontrolle beginnen</Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Freigabelink erstellen. Der Bereich ist vorgegeben (Kontrolle, Beamtenakte
 * oder alle); der geheime Link wird genau einmal angezeigt.
 */
export function ShareDialog({
  open,
  onClose,
  scope,
  checkId,
  lspdOfficerId,
  defaultTitle,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  scope: QcShareScope
  checkId?: string
  lspdOfficerId?: string
  defaultTitle: string
  onCreated?: () => void
}) {
  const { addToast } = useToast()
  const { execute, loading } = useApi<{ path: string }>()
  const [title, setTitle] = useState(defaultTitle)
  const [expiresAt, setExpiresAt] = useState('')
  const [includeCareer, setIncludeCareer] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [failure, setFailure] = useState('')

  const close = () => {
    setLink(null)
    setFailure('')
    onClose()
  }

  const create = async () => {
    setFailure('')
    try {
      const result = await execute('/api/quality-checks/shares', {
        method: 'POST',
        body: JSON.stringify({
          title,
          scope,
          checkId: checkId ?? null,
          lspdOfficerId: lspdOfficerId ?? null,
          includeCareer,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      })
      if (result) {
        setLink(`${window.location.origin}${result.path}`)
        onCreated?.()
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Link konnte nicht erstellt werden')
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      addToast({ type: 'success', title: 'Link kopiert' })
    } catch {
      addToast({ type: 'error', title: 'Kopieren nicht möglich', message: 'Bitte den Link manuell markieren.' })
    }
  }

  return (
    <Modal open={open} onClose={close} title="Freigabelink erstellen" description={QC_SHARE_SCOPE_LABELS[scope]} size="lg">
      {link ? (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#c7c7cc]">
            Wer diesen Link hat, kann die abgeschlossenen Kontrollen ohne Login lesen. Er wird nur jetzt angezeigt.
          </p>
          <div className="flex gap-2">
            <input readOnly value={link} onFocus={(event) => event.target.select()} className="h-[36px] min-w-0 flex-1 rounded-[9px] border border-[#38383a] bg-[#1c1c1e] px-3 font-mono text-[12px] text-white" />
            <Button onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" />
              Kopieren
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={close}>Fertig</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Input label="Bezeichnung" maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          <Input label="Gültig bis (optional)" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          <Checkbox
            checked={includeCareer}
            onCheckedChange={setIncludeCareer}
            label="LSPD-Laufbahn mitteilen (Beförderungen, Sanktionen, Trainings, Kündigungen)"
          />
          <p className="text-[11.5px] text-[#8e8e93]">
            Freigegeben werden nur abgeschlossene Kontrollen. Namen der Prüfer erscheinen im Link nicht.
          </p>
          {failure && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{failure}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Abbrechen</Button>
            <Button onClick={() => void create()} loading={loading} disabled={!title.trim()}>
              <Link2 className="h-3.5 w-3.5" />
              Link erstellen
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
