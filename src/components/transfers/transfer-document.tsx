'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { formatContractDate, type ContractClause } from '@/lib/contracts'
import {
  SIGNATURE_ROLES,
  SIGNATURE_ROLE_META,
  type SignatureRole,
  type TransferRequestStatusValue,
  type TransferSignatureState,
} from '@/lib/transfer-requests'

export interface TransferDocumentData {
  requestNumber: string
  title: string
  status: TransferRequestStatusValue
  content: string
  closing: string
  clauses: ContractClause[]
  place: string
  documentDate: string
  targetAuthority: string | null
  agent: {
    name: string
    badgeNumber: string | null
    rankName: string | null
  }
  signatures: TransferSignatureState[]
}

const DEPARTMENT_NAME = 'Federal Investigation Bureau'

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!markdown.trim()) return null
  return <div className="contract-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Der Versetzungsantrag als Blatt — gleicher Briefkopf, gleiche Typografie und
 * dasselbe Wasserzeichen wie der Arbeitsvertrag, aber mit drei
 * Unterschriftsfeldern statt zweien.
 *
 * `children` wird zwischen Regelungen und Unterschriften eingehängt; dort sitzen
 * auf der Antragsseite die Eingabefelder.
 */
export function TransferDocument({
  document,
  children,
  signatureSlots,
}: {
  document: TransferDocumentData
  children?: React.ReactNode
  /** Optionaler Inhalt unter einer noch offenen Unterschrift (Signierfeld). */
  signatureSlots?: Partial<Record<SignatureRole, React.ReactNode>>
}) {
  const dateLabel = formatContractDate(document.documentDate)
  const completed = document.status === 'COMPLETED'
  const voided = document.status === 'CANCELLED' || document.status === 'DECLINED'

  return (
    <article
      lang="de"
      className="contract-paper"
      style={{ ['--contract-watermark' as string]: 'url(/shield.webp)' }}
    >
      <div className="contract-body">
        <header className="contract-letterhead">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shield.webp" alt="" aria-hidden="true" />
          <div>
            <p className="contract-letterhead-title">{DEPARTMENT_NAME}</p>
            <p className="contract-letterhead-sub">Human Resources Division · {document.place}</p>
          </div>
        </header>

        <h1 className="contract-doc-title">{document.title}</h1>
        <p className="contract-doc-subtitle">
          Aktenzeichen {document.requestNumber} · Ausgestellt in {document.place}
        </p>

        <dl className="contract-meta">
          <div>
            <dt>Antragsteller</dt>
            <dd>{document.agent.name || '—'}</dd>
          </div>
          <div>
            <dt>Dienstnummer</dt>
            <dd>{document.agent.badgeNumber || '—'}</dd>
          </div>
          <div>
            <dt>Dienstgrad</dt>
            <dd>{document.agent.rankName || '—'}</dd>
          </div>
          <div>
            <dt>Entgegennehmende Behörde</dt>
            <dd>{document.targetAuthority || '—'}</dd>
          </div>
        </dl>

        <section className="contract-section">
          <Prose markdown={document.content} />
        </section>

        {document.clauses.length > 0 && (
          <section>
            {document.clauses.map((clause, index) => (
              <section key={clause.id} className="contract-clause">
                <h2 className="contract-clause-heading">
                  § {index + 1} {clause.title}
                </h2>
                <Prose markdown={clause.body} />
              </section>
            ))}
          </section>
        )}

        {document.closing && (
          <section className="contract-section">
            <Prose markdown={document.closing} />
          </section>
        )}

        {children}

        <hr className="contract-divider" />

        <p className="contract-place-date">
          {document.place}, den {dateLabel}
        </p>

        <div className="contract-signature-grid">
          {SIGNATURE_ROLES.map((role) => {
            const signature = document.signatures.find((entry) => entry.role === role)
            const meta = SIGNATURE_ROLE_META[role]
            return (
              <div key={role}>
                <div className="contract-signature-name">{signature?.signedAt ? signature.name : ''}</div>
                <div className="contract-signature-line">
                  {meta.title}
                  {signature?.roleLabel ? ` · ${signature.roleLabel}` : ''}
                  {signature?.signedAt ? ` · ${formatContractDate(signature.signedAt)}` : ''}
                </div>
                {!signature?.signedAt && signatureSlots?.[role]}
              </div>
            )
          })}
        </div>
      </div>

      {completed && (
        <div className="contract-stamp" aria-hidden="true">
          <span className="contract-stamp-top">FIB · Personalabteilung</span>
          <span className="contract-stamp-main">Genehmigt</span>
          <span className="contract-stamp-date">
            {formatContractDate(document.signatures.find((entry) => entry.role === 'AUTHORITY')?.signedAt)}
          </span>
          <span className="contract-stamp-top">{document.place}</span>
        </div>
      )}

      {voided && (
        <div className="contract-void-mark" aria-hidden="true">
          {document.status === 'DECLINED' ? 'Abgelehnt' : 'Ungültig'}
        </div>
      )}
    </article>
  )
}
