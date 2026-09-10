'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, KeyRound, Plus, ShieldOff, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { formatDateTime } from '@/lib/utils'
import type { UploadKeyRow } from './upload-types'

/** Beispielaufruf mit echtem Host — direkt kopierbar. */
function curlExample(key: string) {
  const origin = typeof window === 'undefined' ? 'https://dashboard.example' : window.location.origin
  return `curl -X POST ${origin}/api/files \\
  -H "X-Upload-Key: ${key}" \\
  -F "file=@transkript.html" \\
  -F "title=Ticket #1234" \\
  -F "category=Ticket-Transkript" \\
  -F "externalRef=1234" \\
  -F "tags=ticket,support"`
}

function CopyButton({ value, label = 'Kopieren' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => undefined)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      <Copy size={14} />
      {copied ? 'Kopiert' : label}
    </Button>
  )
}

export function UploadKeysManager() {
  const list = useFetch<{ keys: UploadKeyRow[] }>('/api/upload-keys')
  const { execute, loading } = useApi<{ key: UploadKeyRow; plaintext: string }>()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [defaultCategory, setDefaultCategory] = useState('')
  const [fresh, setFresh] = useState<{ name: string; plaintext: string } | null>(null)
  const [failure, setFailure] = useState('')
  const [confirming, setConfirming] = useState<UploadKeyRow | null>(null)

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    setFailure('')
    try {
      const created = await execute('/api/upload-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(defaultCategory.trim() ? { defaultCategory: defaultCategory.trim() } : {}),
        }),
      })
      if (created) {
        setFresh({ name: created.key.name, plaintext: created.plaintext })
        setCreating(false)
        setName('')
        setDescription('')
        setDefaultCategory('')
        void list.refetch()
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Anlegen fehlgeschlagen')
    }
  }

  const revoke = async (key: UploadKeyRow) => {
    await execute(`/api/upload-keys/${key.id}`, { method: 'PATCH', body: JSON.stringify({ revoke: true }) }).catch(() => null)
    void list.refetch()
  }

  const remove = async (key: UploadKeyRow) => {
    await execute(`/api/upload-keys/${key.id}`, { method: 'DELETE' }).catch(() => null)
    setConfirming(null)
    void list.refetch()
  }

  const keys = list.data?.keys ?? []

  return (
    <div className="mx-auto max-w-4xl pb-6">
      <Link href="/uploads" className="mb-3 inline-flex items-center gap-1 text-xs text-[#a6a6a6] hover:text-white">
        <ArrowLeft size={13} />
        Zurück zu den Uploads
      </Link>
      <PageHeader
        title="Upload-Schlüssel"
        description="Externe Systeme laden damit Dateien hoch — ohne Dashboard-Account und ohne weitere Rechte."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} />
            Schlüssel anlegen
          </Button>
        }
      />

      <div className="mb-5 rounded-xl border border-[#343434] bg-[#141414] p-4 text-sm text-[#a6a6a6]">
        <p className="mb-2 font-semibold text-white">So funktioniert der Upload</p>
        <p>
          Ein <code className="text-[#dcba48]">POST</code> auf <code className="text-[#dcba48]">/api/files</code> als
          <code className="text-[#dcba48]"> multipart/form-data</code>, mit dem Schlüssel im Header
          <code className="text-[#dcba48]"> X-Upload-Key</code>. Pflichtfeld ist nur <code>file</code>; Titel,
          Beschreibung, Kategorie, Tags, Referenz und ein freies <code>metadata</code>-JSON sind optional.
          Die vollständige Beschreibung steht in <code>docs/upload-api.md</code>.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[#343434] bg-[#0d0d0d] p-3 text-xs text-[#c4c4c4]">
          {curlExample('fibup_DEIN_SCHLÜSSEL')}
        </pre>
      </div>

      {list.error && <p role="alert" className="mb-4 text-sm text-red-300">{list.error}</p>}

      {list.loading && !keys.length ? (
        <p className="py-8 text-sm text-[#909090]">Schlüssel werden geladen …</p>
      ) : !keys.length ? (
        <div className="rounded-xl border border-dashed border-[#343434] p-8 text-center text-sm text-[#909090]">
          <KeyRound className="mx-auto mb-3" size={25} />
          Noch kein Upload-Schlüssel angelegt.
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="rounded-xl border border-[#343434] bg-[#141414] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-white">
                    {key.name}
                    {key.revokedAt && <span className="ml-2 text-xs text-red-300">widerrufen</span>}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[#909090]">{key.prefix}</p>
                  {key.description && <p className="mt-2 text-sm text-[#a6a6a6]">{key.description}</p>}
                  <p className="mt-2 text-xs text-[#7a7a7a]">
                    {key._count.uploads} Uploads · {key.usageCount} Aufrufe ·{' '}
                    {key.lastUsedAt ? `zuletzt ${formatDateTime(key.lastUsedAt)}` : 'noch nie benutzt'} · angelegt{' '}
                    {formatDateTime(key.createdAt)}
                    {key.defaultCategory ? ` · Kategorie „${key.defaultCategory}“` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!key.revokedAt && (
                    <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => revoke(key)}>
                      <ShieldOff size={14} />
                      Widerrufen
                    </Button>
                  )}
                  <Button type="button" variant="danger" size="sm" disabled={loading} onClick={() => setConfirming(key)}>
                    <Trash2 size={14} />
                    Löschen
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="Upload-Schlüssel anlegen" size="lg">
          <form className="space-y-4" onSubmit={create}>
            <Input label="Name" required maxLength={80} placeholder="z. B. Ticketboard" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea label="Beschreibung (optional)" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
            <Input
              label="Standard-Kategorie (optional)"
              maxLength={100}
              placeholder="z. B. Ticket-Transkript"
              value={defaultCategory}
              onChange={(e) => setDefaultCategory(e.target.value)}
            />
            <p className="text-xs text-[#909090]">
              Der Schlüssel wird nur einmal im Klartext angezeigt. Danach existiert nur noch sein Hash.
            </p>
            {failure && <p role="alert" className="text-sm text-red-300">{failure}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={loading} onClick={() => setCreating(false)}>
                Abbrechen
              </Button>
              <Button type="submit" loading={loading} disabled={!name.trim()}>
                Anlegen
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {fresh && (
        <Modal open onClose={() => setFresh(null)} title={`Schlüssel „${fresh.name}“`} size="lg">
          <div className="space-y-4">
            <p className="text-sm text-amber-200">
              Jetzt kopieren — nach dem Schließen ist der Klartext nicht mehr abrufbar.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-[#343434] bg-[#0d0d0d] p-3 font-mono text-xs text-[#dcba48]">
                {fresh.plaintext}
              </code>
              <CopyButton value={fresh.plaintext} />
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-wider text-[#7a7a7a]">Direkt einsetzbar</p>
              <pre className="overflow-x-auto rounded-lg border border-[#343434] bg-[#0d0d0d] p-3 text-xs text-[#c4c4c4]">
                {curlExample(fresh.plaintext)}
              </pre>
              <div className="mt-2 flex justify-end">
                <CopyButton value={curlExample(fresh.plaintext)} label="Beispiel kopieren" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setFresh(null)}>
                Schließen
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirming && (
        <Modal
          open
          onClose={() => setConfirming(null)}
          title="Schlüssel löschen?"
          description="Bereits hochgeladene Dateien bleiben erhalten und verlieren nur ihren Herkunftsverweis."
        >
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={loading} onClick={() => setConfirming(null)}>
              Abbrechen
            </Button>
            <Button type="button" variant="danger" loading={loading} onClick={() => remove(confirming)}>
              Endgültig löschen
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
