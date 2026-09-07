'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { formatContractDate, type ContractClause, type ContractStatusValue } from '@/lib/contracts'

export interface ContractDocumentData {
  title: string
  status: ContractStatusValue
  content: string
  closing: string
  clauses: ContractClause[]
  place: string
  documentDate: string
  signedAt: string | null
  signedName: string | null
  agent: {
    firstName: string
    lastName: string
    badgeNumber: string
    rankName: string | null
    hireDate: string | Date | null
  }
}

const DEPARTMENT_NAME = 'Federal Investigation Bureau'

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!markdown.trim()) return null
  return <div className="contract-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Rendert den Vertrag als Dokument: Briefkopf mit Wappen, Wasserzeichen,
 * durchnummerierte Regelungen, Ort/Datum, Unterschriftsfelder und – sobald
 * unterschrieben – den Dienststempel.
 *
 * `children` wird zwischen Regelungen und Unterschriftszeile eingehängt; dort
 * sitzen auf der Signierseite die Eingabefelder des Mitarbeiters.
 */
export function ContractDocument({
  document,
  children,
}: {
  document: ContractDocumentData
  children?: React.ReactNode
}) {
  const agentName = `${document.agent.firstName} ${document.agent.lastName}`.trim()
  const dateLabel = formatContractDate(document.documentDate)
  const signed = document.status === 'SIGNED'
  const voided = document.status === 'CANCELLED' || document.status === 'DECLINED'

  return (
    <article
      // `lang` ist hier funktional, nicht kosmetisch: ohne Sprachangabe macht
      // der Browser keine Silbentrennung, und der Blocksatz reißt dann Löcher
      // zwischen die Wörter.
      lang="de"
      className="contract-paper"
      style={{ ['--contract-watermark' as string]: 'url(/shield.webp)' }}
    >
      <div className="contract-body">
        <header className="contract-letterhead">
          {/* Wappen doppelt genutzt: als Briefkopf-Logo und als Wasserzeichen.
              Bewusst ein einfaches <img>: das Dokument wird gedruckt bzw. als PDF
              gespeichert, und der Wrapper von next/image bricht dabei das
              Briefkopf-Layout. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/shield.webp" alt="" aria-hidden="true" />
          <div>
            <p className="contract-letterhead-title">{DEPARTMENT_NAME}</p>
            <p className="contract-letterhead-sub">Human Resources Division · {document.place}</p>
          </div>
        </header>

        <h1 className="contract-doc-title">{document.title}</h1>
        <p className="contract-doc-subtitle">
          Dokument-Nr. {document.agent.badgeNumber || '—'} · Ausgestellt in {document.place}
        </p>

        <dl className="contract-meta">
          <div>
            <dt>Mitarbeiter</dt>
            <dd>{agentName || '—'}</dd>
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
            <dt>Eintrittsdatum</dt>
            <dd>{formatContractDate(document.agent.hireDate) || '—'}</dd>
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
          <div>
            <div className="contract-signature-name">Personalabteilung</div>
            <div className="contract-signature-line">Für das {DEPARTMENT_NAME}</div>
          </div>
          <div>
            <div className="contract-signature-name">{signed ? document.signedName : ''}</div>
            <div className="contract-signature-line">
              {agentName || 'Mitarbeiter'}
              {signed && document.signedAt ? ` · ${formatContractDate(document.signedAt)}` : ''}
            </div>
          </div>
        </div>
      </div>

      {signed && (
        <div className="contract-stamp" aria-hidden="true">
          <span className="contract-stamp-top">FIB · Personalabteilung</span>
          <span className="contract-stamp-main">Geprüft</span>
          <span className="contract-stamp-date">{formatContractDate(document.signedAt)}</span>
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
