'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  Lock,
  Printer,
  Save,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { TransferDocument, type TransferDocumentData } from '@/components/transfers/transfer-document'
import { formatContractDate, type ContractField, type ContractValues } from '@/lib/contracts'
import {
  SIGNATURE_ROLES,
  SIGNATURE_ROLE_META,
  type SignatureRole,
} from '@/lib/transfer-requests'

interface TransferPayload extends TransferDocumentData {
  id: string
  token: string
  fields: ContractField[]
  values: ContractValues
  openRoles: SignatureRole[]
  declinedAt: string | null
  declineReason: string | null
  viewer: {
    loggedIn: boolean
    displayName: string | null
    canSignHr: boolean
    canSignAgent: boolean
    canSignAuthority: boolean
    canDecline: boolean
  }
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; request: TransferPayload }
  | { kind: 'error'; status: number; message: string }

function paramToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function TransferRequestPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = paramToken(params.token)
  const { addToast } = useToast()

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [values, setValues] = useState<ContractValues>({})
  const [signatureNames, setSignatureNames] = useState<Record<string, string>>({})
  const [authorityRole, setAuthorityRole] = useState('')
  const [busyRole, setBusyRole] = useState<SignatureRole | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  const load = useCallback(async () => {
    if (!token) {
      setState({ kind: 'error', status: 404, message: 'Dieser Antragslink ist unvollständig.' })
      return
    }
    try {
      const res = await fetch(`/api/transfer-links/${encodeURIComponent(token)}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setState({ kind: 'error', status: res.status, message: json.error || 'Antrag konnte nicht geladen werden.' })
        return
      }
      const request = json.data as TransferPayload
      setState({ kind: 'ready', request })
      setValues(request.values ?? {})
    } catch {
      setState({ kind: 'error', status: 0, message: 'Verbindung zum Server fehlgeschlagen.' })
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const request = state.kind === 'ready' ? state.request : null

  // Ausgefüllt wird, solange der Beamte nicht gezeichnet hat — danach ist das
  // Blatt inhaltlich fest.
  const editable = request
    ? !request.signatures.some((signature) => signature.role === 'AGENT' && signature.signedAt)
      && request.status !== 'CANCELLED'
      && request.status !== 'DECLINED'
    : false

  const missingRequired = useMemo(() => {
    if (!request) return []
    return request.fields.filter((field) => {
      if (!field.required) return false
      const value = values[field.id]
      if (field.type === 'CHECKBOX') return value !== true
      return typeof value !== 'string' || value.trim() === ''
    })
  }, [request, values])

  const setValue = (fieldId: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [fieldId]: value }))
  }

  const saveDraft = async () => {
    if (!request) return
    setSavingDraft(true)
    try {
      const res = await fetch(`/api/transfer-links/${encodeURIComponent(token)}/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Speichern fehlgeschlagen')
      addToast({ type: 'success', title: 'Angaben gespeichert' })
      await load()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setSavingDraft(false)
    }
  }

  const sign = async (role: SignatureRole) => {
    if (!request) return
    const name = (signatureNames[role] ?? '').trim()
    if (name.length < 3) {
      addToast({ type: 'error', title: 'Bitte mit vollständigem Namen unterschreiben' })
      return
    }
    if (role === 'AGENT' && missingRequired.length > 0) {
      addToast({
        type: 'error',
        title: 'Es fehlen noch Angaben',
        message: missingRequired.map((field) => field.label).join(', '),
      })
      return
    }

    setBusyRole(role)
    try {
      const res = await fetch(`/api/transfer-links/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          name,
          values: role === 'AGENT' ? values : undefined,
          authorityRole: role === 'AUTHORITY' ? authorityRole : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Unterschreiben fehlgeschlagen')
      addToast({ type: 'success', title: `${SIGNATURE_ROLE_META[role].title} geleistet` })
      setSignatureNames((current) => ({ ...current, [role]: '' }))
      await load()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setBusyRole(null)
    }
  }

  const decline = async () => {
    setDeclining(true)
    try {
      const res = await fetch(`/api/transfer-links/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason: declineReason }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Ablehnen fehlgeschlagen')
      setShowDecline(false)
      addToast({ type: 'success', title: 'Antrag zurückgezogen' })
      await load()
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setDeclining(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-24 text-[#a6a6a6]">
          <PdCloudLoader />
          <p className="text-[13px]">Antrag wird geladen…</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <Notice
          icon={AlertTriangle}
          title={state.status === 404 ? 'Antrag nicht gefunden' : 'Antrag nicht verfügbar'}
          description={state.message}
        >
          <Button variant="secondary" onClick={() => void load()}>Erneut versuchen</Button>
        </Notice>
      </Shell>
    )
  }

  const doc = state.request
  const canSign: Record<SignatureRole, boolean> = {
    HR: doc.viewer.canSignHr,
    AGENT: doc.viewer.canSignAgent,
    AUTHORITY: doc.viewer.canSignAuthority,
  }
  const finished = doc.status === 'COMPLETED'
  const closed = doc.status === 'CANCELLED' || doc.status === 'DECLINED'

  return (
    <Shell>
      <div className="contract-no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]">
            Federal Investigation Bureau
          </p>
          <h1 className="mt-1 text-[20px] font-semibold text-white">{doc.title}</h1>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
            Aktenzeichen {doc.requestNumber} · {doc.openRoles.length === 0
              ? 'Alle Unterschriften liegen vor'
              : `Offen: ${doc.openRoles.map((role) => SIGNATURE_ROLE_META[role].title).join(', ')}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Drucken / als PDF speichern
        </Button>
      </div>

      {!closed && !finished && (
        <div className="contract-no-print mb-5 rounded-[14px] border border-[#d4d4d4]/30 bg-[#302712]/45 p-4">
          <div className="flex items-start gap-3">
            <FileSignature size={18} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
            <div>
              <p className="text-[13px] font-semibold text-white">So läuft der Antrag</p>
              <ul className="mt-1.5 space-y-1 text-[12.5px] leading-5 text-[#c6c6c6]">
                <li>Der Beamte füllt die Angaben aus und unterschreibt zuerst.</li>
                <li>Die Personalabteilung des FIB zeichnet den Antrag ab.</li>
                <li>Die entgegennehmende Behörde unterschreibt zuletzt — dafür ist kein Konto nötig.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {doc.status === 'DECLINED' && (
        <div className="contract-no-print mb-5 rounded-[14px] border border-[#7f1d1d]/50 bg-[#2a1620]/60 p-4">
          <p className="text-[13px] font-semibold text-white">Antrag zurückgezogen</p>
          <p className="mt-1 text-[12.5px] leading-5 text-[#f3b7b7]">
            Am {formatContractDate(doc.declinedAt)}
            {doc.declineReason ? ` · ${doc.declineReason}` : ''}
          </p>
        </div>
      )}

      <TransferDocument
        document={doc}
        signatureSlots={
          closed
            ? undefined
            : Object.fromEntries(
                SIGNATURE_ROLES.map((role) => [
                  role,
                  <SignatureSlot
                    key={role}
                    role={role}
                    allowed={canSign[role]}
                    loggedIn={doc.viewer.loggedIn}
                    token={token}
                    value={signatureNames[role] ?? ''}
                    onChange={(value) => setSignatureNames((current) => ({ ...current, [role]: value }))}
                    authorityRole={authorityRole}
                    onAuthorityRoleChange={setAuthorityRole}
                    busy={busyRole === role}
                    onSign={() => sign(role)}
                  />,
                ]),
              ) as Partial<Record<SignatureRole, React.ReactNode>>
        }
      >
        <TransferFieldsSection
          fields={doc.fields}
          values={values}
          editable={editable}
          onChange={setValue}
        />
      </TransferDocument>

      {editable && (
        <div className="contract-no-print mt-5 rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/80 p-4">
          {missingRequired.length > 0 && (
            <p className="mb-3 text-[12.5px] text-[#f3b7b7]">
              Noch offen: {missingRequired.map((field) => field.label).join(', ')}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {doc.viewer.canDecline && (
              <Button variant="ghost" size="sm" onClick={() => setShowDecline((open) => !open)}>
                Antrag zurückziehen
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={saveDraft} loading={savingDraft}>
              <Save size={14} />
              Angaben speichern
            </Button>
          </div>

          {showDecline && (
            <div className="mt-4 rounded-[12px] border border-[#3b1616] bg-[#1c1111]/70 p-3">
              <p className="text-[12.5px] text-[#fca5a5]">
                Der Antrag wird damit beendet und kann nicht mehr unterschrieben werden.
              </p>
              <textarea
                value={declineReason}
                onChange={(event) => setDeclineReason(event.target.value)}
                rows={3}
                placeholder="Grund (optional)"
                className="mt-2 w-full resize-none rounded-[9px] border border-[#4a2020]/70 bg-[#120b0b]/60 px-3 py-2 text-[13px] text-[#f4f4f4] outline-none placeholder:text-[#7a5555] focus:border-[#b45252]"
              />
              <div className="mt-2 flex justify-end">
                <Button variant="danger" size="sm" onClick={decline} loading={declining}>
                  Rückzug bestätigen
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="contract-no-print mt-5 flex items-start gap-3 rounded-[14px] border border-[#1d4230]/60 bg-[#0d2419]/70 p-4">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#86efac]" />
          <div>
            <p className="text-[13px] font-semibold text-white">Antrag vollständig unterschrieben</p>
            <p className="mt-1 text-[12.5px] leading-5 text-[#9fd9b6]">
              Alle drei Unterschriften liegen vor. Die Personalabteilung sieht den Antrag im Dashboard.
            </p>
          </div>
        </div>
      )}
    </Shell>
  )
}

/**
 * Unterschriftsfeld direkt unter der jeweiligen Linie im Dokument. Wer nicht
 * zeichnen darf, sieht statt der Eingabe den Grund — das ist bei drei
 * unterschiedlichen Berechtigungen klarer als ein ausgegrautes Feld.
 */
function SignatureSlot({
  role,
  allowed,
  loggedIn,
  token,
  value,
  onChange,
  authorityRole,
  onAuthorityRoleChange,
  busy,
  onSign,
}: {
  role: SignatureRole
  allowed: boolean
  loggedIn: boolean
  token: string
  value: string
  onChange: (value: string) => void
  authorityRole: string
  onAuthorityRoleChange: (value: string) => void
  busy: boolean
  onSign: () => void
}) {
  const meta = SIGNATURE_ROLE_META[role]

  if (!allowed) {
    const needsLogin = !loggedIn && role !== 'AUTHORITY'
    return (
      <div className="contract-no-print mt-2 rounded-[9px] border border-[#343434]/55 bg-[#181818]/50 px-2.5 py-2">
        <p className="text-[11px] leading-4 text-[#a6a6a6]">{meta.who}</p>
        {needsLogin && (
          <a
            href={`/api/auth/discord/login?mode=contract&redirect=${encodeURIComponent(`/versetzung/${token}`)}`}
            className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#d4d4d4] hover:underline"
          >
            <Lock size={11} />
            Mit Discord anmelden
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="contract-no-print mt-2 space-y-1.5">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Vor- und Nachname"
        className="contract-field-input contract-signature-input"
      />
      {role === 'AUTHORITY' && (
        <input
          value={authorityRole}
          onChange={(event) => onAuthorityRoleChange(event.target.value)}
          placeholder="Behörde / Funktion (optional)"
          className="contract-field-input"
        />
      )}
      <Button size="sm" onClick={onSign} loading={busy}>
        <FileSignature size={13} />
        Unterschreiben
      </Button>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#080808] px-3 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto w-full max-w-[900px]">{children}</div>
    </main>
  )
}

function Notice({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Lock
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/12 text-[#d4d4d4]">
        <Icon size={26} />
      </div>
      <h1 className="text-[19px] font-semibold text-white">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-[#a6a6a6]">{description}</p>
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </section>
  )
}

function TransferFieldsSection({
  fields,
  values,
  editable,
  onChange,
}: {
  fields: ContractField[]
  values: ContractValues
  editable: boolean
  onChange: (fieldId: string, value: string | boolean) => void
}) {
  if (fields.length === 0) return null

  return (
    <section className="contract-section">
      <h2 className="contract-clause-heading">Angaben des Antragstellers</h2>
      <div className="mt-3 space-y-3">
        {fields.map((field) => (
          <TransferFieldRow
            key={field.id}
            field={field}
            value={values[field.id]}
            editable={editable}
            onChange={(value) => onChange(field.id, value)}
          />
        ))}
      </div>
    </section>
  )
}

function TransferFieldRow({
  field,
  value,
  editable,
  onChange,
}: {
  field: ContractField
  value: string | boolean | undefined
  editable: boolean
  onChange: (value: string | boolean) => void
}) {
  const textValue = typeof value === 'string' ? value : ''

  if (field.type === 'CHECKBOX') {
    return (
      <label className="contract-field-checkbox">
        <input
          type="checkbox"
          checked={value === true}
          disabled={!editable}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {field.label}
          {field.required && <span className="contract-field-required"> *</span>}
          {field.description && <span className="contract-field-hint block">{field.description}</span>}
        </span>
      </label>
    )
  }

  return (
    <div>
      <label className="contract-field-label">
        {field.label}
        {field.required && <span className="contract-field-required"> *</span>}
      </label>
      {field.description && <p className="contract-field-hint">{field.description}</p>}

      {!editable ? (
        <p className={field.type === 'SIGNATURE' ? 'contract-signature-name' : 'contract-field-value'}>
          {field.type === 'DATE' ? formatContractDate(textValue) || '—' : textValue || '—'}
        </p>
      ) : field.type === 'LONG_TEXT' ? (
        <textarea
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder={field.placeholder ?? ''}
          className="contract-field-input resize-none"
        />
      ) : (
        <input
          type={field.type === 'DATE' ? 'date' : 'text'}
          value={textValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder ?? ''}
          className={cn('contract-field-input', field.type === 'SIGNATURE' && 'contract-signature-input')}
        />
      )}
    </div>
  )
}
