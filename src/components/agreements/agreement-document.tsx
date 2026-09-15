'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { CONTRACT_PLACE, formatContractDate, type ContractClause } from '@/lib/contracts'
import type { AgreementLetterhead, AgreementStatus } from '@/lib/agreements'

export interface AgreementDocumentParty {
  id: string
  name: string
  role: string | null
  signedAt: string | null
  signedName: string | null
  declinedAt: string | null
}

export interface AgreementDocumentData {
  title: string
  status: AgreementStatus
  letterhead: AgreementLetterhead
  content: string
  clauses: ContractClause[]
  closing: string | null
  releasedAt: string | null
  parties: AgreementDocumentParty[]
}

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!markdown.trim()) return null
  return <div className="contract-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Nutzt die Papier-Optik der Arbeitsverträge, ohne deren Agent-Bezug. */
export function AgreementDocument({ document, children }: { document: AgreementDocumentData; children?: React.ReactNode }) {
  const fib = document.letterhead === 'FIB'
  const signed = document.status === 'SIGNED'
  const voided = document.status === 'CANCELLED' || document.status === 'DECLINED'
  const lastSignature = document.parties.map((party) => party.signedAt).filter(Boolean).sort().pop() ?? null
  const dateLabel = formatContractDate(signed ? lastSignature : document.releasedAt ?? new Date())

  return (
    <article
      lang="de"
      className="contract-paper"
      style={{ ['--contract-watermark' as string]: fib ? 'url(/shield.webp)' : 'none' }}
    >
      <div className="contract-body">
        {fib && (
          <header className="contract-letterhead">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shield.webp" alt="" aria-hidden="true" />
            <div>
              <p className="contract-letterhead-title">Federal Investigation Bureau</p>
              <p className="contract-letterhead-sub">Vertragsdokument · {CONTRACT_PLACE}</p>
            </div>
          </header>
        )}

        <h1 className="contract-doc-title">{document.title}</h1>
        <p className="contract-doc-subtitle">Ausgestellt in {CONTRACT_PLACE}</p>

        <dl className="contract-meta">
          {document.parties.map((party, index) => (
            <div key={party.id}>
              <dt>Partei {index + 1}</dt>
              <dd>
                {party.name}
                {party.role ? ` · ${party.role}` : ''}
              </dd>
            </div>
          ))}
        </dl>

        <section className="contract-section">
          <Prose markdown={document.content} />
        </section>

        {document.clauses.map((clause, index) => (
          <section key={clause.id} className="contract-clause">
            <h2 className="contract-clause-heading">
              § {index + 1} {clause.title}
            </h2>
            <Prose markdown={clause.body} />
          </section>
        ))}

        {document.closing && (
          <section className="contract-section">
            <Prose markdown={document.closing} />
          </section>
        )}

        {children}

        <hr className="contract-divider" />
        <p className="contract-place-date">
          {CONTRACT_PLACE}, den {dateLabel}
        </p>

        <div className="contract-signature-grid">
          {document.parties.map((party) => (
            <div key={party.id}>
              <div className="contract-signature-name">{party.signedName ?? ''}</div>
              <div className="contract-signature-line">
                {party.name}
                {party.role ? ` · ${party.role}` : ''}
                {party.signedAt ? ` · ${formatContractDate(party.signedAt)}` : ''}
                {party.declinedAt ? ' · abgelehnt' : ''}
              </div>
            </div>
          ))}
        </div>
      </div>

      {fib && signed && (
        <div className="contract-stamp" aria-hidden="true">
          <span className="contract-stamp-top">FIB · Vertrag</span>
          <span className="contract-stamp-main">Geschlossen</span>
          <span className="contract-stamp-date">{formatContractDate(lastSignature)}</span>
          <span className="contract-stamp-top">{CONTRACT_PLACE}</span>
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
