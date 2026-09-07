'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileSignature,
  Lock,
  Printer,
  ShieldX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdCloudLoader } from '@/components/ui/loading'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ContractDocument, type ContractDocumentData } from '@/components/contracts/contract-document'
import {
  formatContractDate,
  type ContractField,
  type ContractStatusValue,
  type ContractValues,
} from '@/lib/contracts'

interface ContractPayload extends ContractDocumentData {
  id: string
  token: string
  /** 'signer' = der Agent selbst, 'auditor' = Einsicht über Prüfrolle/HR. */
  access: 'signer' | 'auditor'
  fields: ContractField[]
  values: ContractValues
  declinedAt: string | null
  declineReason: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; contract: ContractPayload }
  | { kind: 'login' }
  | { kind: 'error'; status: number; message: string }

function paramToken(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function ContractSigningPage() {
  const params = useParams<{ token: string | string[] }>()
  const token = paramToken(params.token)
  const { addToast } = useToast()

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [values, setValues] = useState<ContractValues>({})
  const [submitting, setSubmitting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)

  const load = useMemo(
    () => async () => {
      if (!token) {
        setState({ kind: 'error', status: 404, message: 'Dieser Vertragslink ist unvollständig.' })
        return
      }
      try {
        const res = await fetch(`/api/contract-links/${encodeURIComponent(token)}`, { cache: 'no-store' })
        const json = await res.json()
        if (res.status === 401) {
          setState({ kind: 'login' })
          return
        }
        if (!res.ok || !json.success) {
          setState({ kind: 'error', status: res.status, message: json.error || 'Vertrag konnte nicht geladen werden.' })
          return
        }
        const contract = json.data as ContractPayload
        setState({ kind: 'ready', contract })
        setValues(contract.values ?? {})
      } catch {
        setState({ kind: 'error', status: 0, message: 'Verbindung zum Server fehlgeschlagen.' })
      }
    },
    [token],
  )

  useEffect(() => {
    void load()
  }, [load])

  const contract = state.kind === 'ready' ? state.contract : null
  // Prüfer sehen denselben Vertrag, dürfen aber nichts daran ändern.
  const editable = contract
    ? contract.access === 'signer' && (contract.status === 'DRAFT' || contract.status === 'SENT')
    : false

  const missingRequired = useMemo(() => {
    if (!contract || !editable) return []
    return contract.fields.filter((field) => {
      const value = values[field.id]
      if (!field.required) return false
      if (field.type === 'CHECKBOX') return value !== true
      return typeof value !== 'string' || value.trim() === ''
    })
  }, [contract, editable, values])

  const setValue = (fieldId: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [fieldId]: value }))
  }

  const submit = async () => {
    if (!contract) return
    if (missingRequired.length > 0) {
      addToast({
        type: 'error',
        title: 'Es fehlen noch Angaben',
        message: missingRequired.map((field) => field.label).join(', '),
      })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/contract-links/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Unterschreiben fehlgeschlagen')
      setState({ kind: 'ready', contract: json.data as ContractPayload })
      addToast({ type: 'success', title: 'Vertrag unterschrieben' })
    } catch (e) {
      addToast({ type: 'error', title: 'Fehler', message: e instanceof Error ? e.message : '' })
    } finally {
      setSubmitting(false)
    }
  }

  const decline = async () => {
    if (!contract) return
    setDeclining(true)
    try {
      const res = await fetch(`/api/contract-links/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline', reason: declineReason }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Ablehnen fehlgeschlagen')
      setState({ kind: 'ready', contract: json.data as ContractPayload })
      setShowDecline(false)
      addToast({ type: 'success', title: 'Vertrag abgelehnt' })
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
          <p className="text-[13px]">Vertrag wird geladen…</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'login') {
    const target = `/api/auth/discord/login?mode=contract&redirect=${encodeURIComponent(`/vertrag/${token}`)}`
    return (
      <Shell>
        <Notice
          icon={Lock}
          title="Bitte mit Discord anmelden"
          description="Dein Arbeitsvertrag ist persönlich. Melde dich mit dem Discord-Account an, an den der Vertrag geschickt wurde — nur dieser Account kann ihn öffnen und unterschreiben."
        >
          <a href={target}>
            <Button size="lg">Mit Discord anmelden</Button>
          </a>
        </Notice>
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <Notice
          icon={state.status === 403 ? ShieldX : AlertTriangle}
          title={state.status === 404 ? 'Vertrag nicht gefunden' : 'Vertrag nicht verfügbar'}
          description={state.message}
        >
          <Button variant="secondary" onClick={() => void load()}>
            Erneut versuchen
          </Button>
        </Notice>
      </Shell>
    )
  }

  const signedContract = state.contract

  return (
    <Shell>
      <div className="contract-no-print mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d4d4d4]">
            Federal Investigation Bureau
          </p>
          <h1 className="mt-1 text-[20px] font-semibold text-white">{signedContract.title}</h1>
          <p className="mt-1 text-[12.5px] text-[#a6a6a6]">
            <StatusLine contract={signedContract} />
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Drucken / als PDF speichern
        </Button>
      </div>

      {signedContract.access === 'auditor' && (
        <div className="contract-no-print mb-5 rounded-[14px] border border-[#373737]/55 bg-[#181818]/60 p-4">
          <div className="flex items-start gap-3">
            <Eye size={18} className="mt-0.5 shrink-0 text-[#93c5fd]" />
            <div>
              <p className="text-[13px] font-semibold text-white">Einsicht</p>
              <p className="mt-1 text-[12.5px] leading-5 text-[#a6a6a6]">
                Du siehst diesen Vertrag über deine Berechtigung zur Vertragseinsicht. Ändern oder
                unterschreiben kann ihn ausschließlich der Agent selbst.
              </p>
            </div>
          </div>
        </div>
      )}

      {editable && (
        <div className="contract-no-print mb-5 rounded-[14px] border border-[#d4d4d4]/30 bg-[#302712]/45 p-4">
          <div className="flex items-start gap-3">
            <FileSignature size={18} className="mt-0.5 shrink-0 text-[#d4d4d4]" />
            <div>
              <p className="text-[13px] font-semibold text-white">Vertrag ausfüllen und unterschreiben</p>
              <p className="mt-1 text-[12.5px] leading-5 text-[#c6c6c6]">
                Lies den Vertrag vollständig durch, fülle die Felder im Abschnitt „Angaben des
                Mitarbeiters“ aus und unterschreibe unten. Ohne unterschriebenen Vertrag kann deine
                Einstellung nicht abgeschlossen werden.
              </p>
            </div>
          </div>
        </div>
      )}

      <ContractDocument document={signedContract}>
        <ContractFieldsSection
          fields={signedContract.fields}
          values={values}
          editable={editable}
          onChange={setValue}
        />
      </ContractDocument>

      {editable && (
        <div className="contract-no-print mt-5 rounded-[14px] border border-[#373737]/45 bg-[#1b1b1b]/80 p-4">
          {missingRequired.length > 0 && (
            <p className="mb-3 text-[12.5px] text-[#f3b7b7]">
              Noch offen: {missingRequired.map((field) => field.label).join(', ')}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDecline((open) => !open)}
              disabled={submitting}
            >
              Vertrag ablehnen
            </Button>
            <Button onClick={submit} loading={submitting} disabled={missingRequired.length > 0}>
              <FileSignature size={15} />
              Rechtsverbindlich unterschreiben
            </Button>
          </div>

          {showDecline && (
            <div className="mt-4 rounded-[12px] border border-[#3b1616] bg-[#1c1111]/70 p-3">
              <p className="text-[12.5px] text-[#fca5a5]">
                Wenn du ablehnst, wird die Personalabteilung informiert und deine Einstellung nicht
                abgeschlossen.
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
                  Ablehnung bestätigen
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {signedContract.status === 'SIGNED' && signedContract.access === 'signer' && (
        <div className="contract-no-print mt-5 flex items-start gap-3 rounded-[14px] border border-[#1d4230]/60 bg-[#0d2419]/70 p-4">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#86efac]" />
          <div>
            <p className="text-[13px] font-semibold text-white">Vertrag unterschrieben</p>
            <p className="mt-1 text-[12.5px] leading-5 text-[#9fd9b6]">
              Unterschrieben am {formatContractDate(signedContract.signedAt)} von{' '}
              {signedContract.signedName}. Die Personalabteilung sieht deine Unterschrift jetzt im
              Dashboard — du musst nichts weiter tun.
            </p>
          </div>
        </div>
      )}
    </Shell>
  )
}

function StatusLine({ contract }: { contract: ContractPayload }) {
  // Für Prüfer neutral formulieren — „deine Unterschrift“ wäre dort falsch.
  const pending = contract.access === 'signer'
    ? 'Warten auf deine Unterschrift'
    : 'Noch nicht unterschrieben'

  const labels: Record<ContractStatusValue, string> = {
    DRAFT: pending,
    SENT: pending,
    SIGNED: `Unterschrieben am ${formatContractDate(contract.signedAt)} von ${contract.signedName ?? '—'}`,
    DECLINED: `Abgelehnt am ${formatContractDate(contract.declinedAt)}`,
    CANCELLED: 'Von der Personalabteilung zurückgezogen',
  }
  return <>{labels[contract.status]}</>
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

/**
 * Die Felder liegen bewusst INNERHALB des Dokuments – so liest sich der Vertrag
 * durchgängig wie ein Formular auf Papier statt wie ein Web-Formular neben einem
 * Text.
 */
function ContractFieldsSection({
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
      <h2 className="contract-clause-heading">Angaben des Mitarbeiters</h2>
      <div className="mt-3 space-y-3">
        {fields.map((field) => (
          <ContractFieldRow
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

function ContractFieldRow({
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
          {field.description && (
            <span className="contract-field-hint block">{field.description}</span>
          )}
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
