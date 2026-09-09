'use client'

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'
import { penalGradeLabel, resolveViolation, sanctionLevelLabel } from '@/lib/sanction-catalog'
import {
  CONTRACT_CLAUSE_6_BODY,
  CONTRACT_CLAUSE_6_TITLE,
  type LegalCaseKindValue,
  type LegalCaseStatusValue,
  type LegalCaseSanctionSnapshot,
} from '@/lib/legal-cases'

export interface LegalCaseAccused {
  name: string | null
  badge: string | null
  rank: string | null
  discordId: string | null
  address: string | null
}

export interface LegalCaseDocumentData {
  id: string
  token: string
  caseNumber: string
  kind: LegalCaseKindValue
  status: LegalCaseStatusValue
  title: string
  subject: string
  content: string
  closing: string | null
  accused: LegalCaseAccused
  sanctions: LegalCaseSanctionSnapshot[]
  signerName: string | null
  place: string
  documentDate: string
  filedAt: string | null
  closedAt: string | null
}

const DEPARTMENT_NAME = 'Federal Investigation Bureau'
const DIVISION_NAME = 'Legal Affairs Division'
const DEPARTMENT_ADDRESS = 'Elite Street 1 · Nerowood'

function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function Prose({ markdown }: { markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  if (!markdown.trim()) return null
  return <div className="lawsuit-prose" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Rendert die Klageschrift als offizielles, amtliches Dokument — angelehnt an
 * einen deutschen Gerichtsschriftssatz: Briefkopf mit Wappen, Anschriftenblock,
 * "In Sachen"-Rubrum, Beweismittelverzeichnis, Antrag und Rundstempel.
 */
export function LegalCaseDocument({ document }: { document: LegalCaseDocumentData }) {
  const accused = document.accused
  const filed = document.status === 'FILED'
  const closed = document.status === 'CLOSED'
  const showContractClause = document.kind === 'SANCTION' || document.sanctions.length > 0

  return (
    <>
      {/* Handschrift-Schriftart für die Unterschrift — lädt nur auf den Seiten,
          die eine Klageschrift anzeigen; offline greifen die System-Kursiven. */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" />
      <article lang="de" className="lawsuit-paper">
        <div className="lawsuit-inner">
        {/* Briefkopf */}
        <header className="lawsuit-letterhead">
          <div className="lawsuit-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shield.webp" alt="" aria-hidden="true" />
            <div>
              <p className="lawsuit-dept">{DEPARTMENT_NAME}</p>
              <p className="lawsuit-division">{DIVISION_NAME}</p>
              <p className="lawsuit-contact">{DEPARTMENT_ADDRESS}</p>
            </div>
          </div>
          <div className="lawsuit-letterhead-meta">
            <div className="lawsuit-meta-row">
              <p className="lawsuit-meta-label">Aktenzeichen</p>
              <p className="lawsuit-meta-value">{document.caseNumber}</p>
            </div>
            <div className="lawsuit-meta-row">
              <p className="lawsuit-meta-label">Datum</p>
              <p className="lawsuit-meta-value">{formatDate(document.documentDate)}</p>
            </div>
          </div>
        </header>

        {/* Gerichts-/Anschriftenblock */}
        <div className="lawsuit-court">
          <p className="lawsuit-court-box">
            An das für <strong>Dienstsachen</strong> zuständige
            <br />
            Gericht des Department of Justice
          </p>
        </div>

        {/* Titel */}
        <h1 className="lawsuit-title">{document.title}</h1>
        <div className="lawsuit-title-rule" />
        <p className="lawsuit-subtitle">
          {document.status === 'FILED' ? `Eingereicht am ${formatDate(document.filedAt)}` : document.status === 'CLOSED' ? `Geschlossen am ${formatDate(document.closedAt)}` : 'Entwurf — noch nicht eingereicht'}
        </p>

        {/* Rubrum */}
        <section className="lawsuit-rubrum">
          <p className="lawsuit-rubrum-lead">In Sachen</p>
          <div className="lawsuit-parties">
            <div className="lawsuit-party">
              <p className="lawsuit-party-label">Kläger</p>
              <p className="lawsuit-party-name">{DEPARTMENT_NAME}</p>
              <p className="lawsuit-party-line">vertreten durch die {DIVISION_NAME}, {document.place}</p>
            </div>
            <div className="lawsuit-party">
              <p className="lawsuit-party-label">Beklagter</p>
              <p className="lawsuit-party-name">{accused.name || '—'}</p>
              <p className="lawsuit-party-line">
                {[accused.badge ? `Dienstnummer ${accused.badge}` : null, accused.rank].filter(Boolean).join(' · ') || '—'}
              </p>
              {accused.discordId && <p className="lawsuit-party-line">Discord-ID: {accused.discordId}</p>}
              {accused.address && <p className="lawsuit-party-line">{accused.address}</p>}
            </div>
          </div>
        </section>

        {/* Betreff */}
        {document.subject && (
          <section className="lawsuit-section">
            <h2 className="lawsuit-heading">Betreff</h2>
            <p className="lawsuit-subject">{document.subject}</p>
          </section>
        )}

        {/* Sachverhalt */}
        <section className="lawsuit-section">
          <h2 className="lawsuit-heading">Sachverhalt</h2>
          <Prose markdown={document.content} />
        </section>

        {/* Beweismittel */}
        {document.sanctions.length > 0 && (
          <section className="lawsuit-section">
            <h2 className="lawsuit-heading">Beweismittel</h2>
            <ol className="lawsuit-evidence">
              {document.sanctions.map((sanction, index) => (
                <li key={sanction.sanctionId || index}>
                  <p className="lawsuit-evidence-title">
                    Sanktion belegt in der Personalakte — {penalGradeLabel(sanction.penalGrade)}
                  </p>
                  <p className="lawsuit-evidence-meta">
                    Maßnahme: {sanctionLevelLabel(sanction.level)}
                    {resolveViolation(sanction.violationCode)
                      ? ` · Verstoß: ${resolveViolation(sanction.violationCode)!.label}`
                      : ''}
                  </p>
                  <p className="lawsuit-evidence-meta">Grund: {sanction.reason}</p>
                  <p className="lawsuit-evidence-meta">
                    Ausgesprochen am {formatDate(sanction.createdAt)}
                    {sanction.suspendedUntil ? ` · suspendiert bis ${formatDate(sanction.suspendedUntil)}` : ''}
                  </p>
                </li>
              ))}
            </ol>

            {showContractClause && (
              <div className="lawsuit-clause-box">
                <p className="lawsuit-clause-heading">Aktenauszug · Arbeitsvertrag · § {CONTRACT_CLAUSE_6_TITLE}</p>
                <Prose markdown={CONTRACT_CLAUSE_6_BODY} />
              </div>
            )}
          </section>
        )}

        {/* Antrag */}
        {document.closing && (
          <section className="lawsuit-section">
            <h2 className="lawsuit-heading">Antrag</h2>
            <Prose markdown={document.closing} />
          </section>
        )}

        <hr className="lawsuit-divider" />

        <p className="lawsuit-place-date">{document.place}, den {formatDate(document.documentDate)}</p>

        <div className="lawsuit-signatures">
          <div>
            <div className="lawsuit-signature-name lawsuit-signature-script">
              {document.signerName ?? 'Rechtsabteilung'}
            </div>
            <div className="lawsuit-signature-line">Klägervertretung · {DIVISION_NAME}</div>
          </div>
          <div>
            <div className="lawsuit-signature-name" />
            <div className="lawsuit-signature-line">Beklagtenvertretung</div>
          </div>
        </div>

        <footer className="lawsuit-footer">
          <span>{DEPARTMENT_NAME} · {DIVISION_NAME}</span>
          <span>{document.caseNumber} · Klageschrift</span>
        </footer>
      </div>

      {filed && (
        <div className="lawsuit-seal" aria-hidden="true">
          <span className="lawsuit-seal-top">{DEPARTMENT_NAME}</span>
          <span className="lawsuit-seal-main">Eingereicht</span>
          <span className="lawsuit-seal-date">{formatDate(document.filedAt)}</span>
          <span className="lawsuit-seal-top">{document.place}</span>
        </div>
      )}

      {closed && (
        <div className="lawsuit-seal" aria-hidden="true">
          <span className="lawsuit-seal-top">{DEPARTMENT_NAME}</span>
          <span className="lawsuit-seal-main">Geschlossen</span>
          <span className="lawsuit-seal-date">{formatDate(document.closedAt)}</span>
          <span className="lawsuit-seal-top">{document.place}</span>
        </div>
      )}

      {document.status === 'DRAFT' && (
        <div className="lawsuit-draft-mark" aria-hidden="true">
          Entwurf
        </div>
      )}
      </article>
    </>
  )
}
