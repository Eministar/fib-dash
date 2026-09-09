'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { formatContractDate, type ContractClause, type ContractStatusValue } from '@/lib/contracts'

/** Eine Partei, die den Vertrag unterschreibt. */
export interface ContractDocumentParty {
  id: string
  side: string
  partyName: string
  partyRole: string | null
  signedAt: string | Date | null
  signedName: string | null
  declinedAt: string | Date | null
}

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
  /** AGENT = Arbeitsvertrag, AGENCY = Vereinbarung mit einer externen Behörde. */
  kind?: string
  counterpartyName?: string | null
  counterpartyRole?: string | null
  /** Bei einem Behördenvertrag gibt es keinen Mitarbeiter. */
  agent: {
    firstName: string
    lastName: string
    badgeNumber: string
    rankName: string | null
    hireDate: string | Date | null
  } | null
  /** Wenn gesetzt, entsteht die Unterschriftszeile aus diesen Parteien. */
  parties?: ContractDocumentParty[]
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
  const agent = document.agent
  const agentName = agent ? `${agent.firstName} ${agent.lastName}`.trim() : ''
  const dateLabel = formatContractDate(document.documentDate)
  const signed = document.status === 'SIGNED'
  const voided = document.status === 'CANCELLED' || document.status === 'DECLINED'
  const isAgency = document.kind === 'AGENCY'

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
          {isAgency
            ? `Vereinbarung zwischen zwei Behörden · Ausgestellt in ${document.place}`
            : `Dokument-Nr. ${agent?.badgeNumber || '—'} · Ausgestellt in ${document.place}`}
        </p>

        {/* Ein Arbeitsvertrag nennt den Mitarbeiter, ein Behördenvertrag die
            beiden Seiten — dieselbe Zeile trüge sonst falsche Begriffe. */}
        <dl className="contract-meta">
          {isAgency ? (
            <>
              <div>
                <dt>Vertragspartner</dt>
                <dd>{DEPARTMENT_NAME}</dd>
              </div>
              <div>
                <dt>Gegenpartei</dt>
                <dd>{document.counterpartyName || '—'}</dd>
              </div>
              <div>
                <dt>Vertreten durch</dt>
                <dd>{document.counterpartyRole || '—'}</dd>
              </div>
              <div>
                <dt>Ausgestellt</dt>
                <dd>{dateLabel || '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Mitarbeiter</dt>
                <dd>{agentName || '—'}</dd>
              </div>
              <div>
                <dt>Dienstnummer</dt>
                <dd>{agent?.badgeNumber || '—'}</dd>
              </div>
              <div>
                <dt>Dienstgrad</dt>
                <dd>{agent?.rankName || '—'}</dd>
              </div>
              <div>
                <dt>Eintrittsdatum</dt>
                <dd>{formatContractDate(agent?.hireDate ?? null) || '—'}</dd>
              </div>
            </>
          )}
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
          {document.parties && document.parties.length > 0 ? (
            // Ein Block je Partei — bei zwei Behörden stehen sich beide
            // gegenüber, bei einem Arbeitsvertrag bleibt es bei einem Feld.
            document.parties.map((party) => (
              <div key={party.id}>
                <div className="contract-signature-name">{party.signedName ?? ''}</div>
                <div className="contract-signature-line">
                  {party.partyName}
                  {party.partyRole ? ` · ${party.partyRole}` : ''}
                  {party.signedAt ? ` · ${formatContractDate(party.signedAt)}` : ''}
                  {party.declinedAt ? ' · abgelehnt' : ''}
                </div>
              </div>
            ))
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      {signed && (
        <div className="contract-stamp" aria-hidden="true">
          <span className="contract-stamp-top">
            {isAgency ? 'FIB · Behördenvereinbarung' : 'FIB · Personalabteilung'}
          </span>
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
