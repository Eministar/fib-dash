'use client'

import { raidDocument, RAID_URGENCY, type RaidAttachment, type RaidRequest } from '@/lib/raid-request'

const DEPARTMENT_NAME = 'Federal Investigation Bureau'
const DIVISION_NAME = 'Ermittlungsabteilung'
const DEPARTMENT_ADDRESS = 'Elite Street 1 · Nerowood'

/**
 * Razzia-Antrag als amtliches Schriftstück – gleiches Papier, gleicher
 * Briefkopf und gleiche Siegel-Optik wie die Klageschrift der Legal Affairs.
 */
export function RaidRequestDocument({ request, reference, createdAt, attachments }: {
  request: RaidRequest
  reference: string
  createdAt: Date
  attachments: RaidAttachment[]
}) {
  const doc = raidDocument(request, { reference, createdAt, attachments })
  const urgent = request.urgency !== 'REGULAR'

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" />
      <article lang="de" className="lawsuit-paper">
        <div className="lawsuit-inner">
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
                <p className="lawsuit-meta-value">{doc.reference}</p>
              </div>
              <div className="lawsuit-meta-row">
                <p className="lawsuit-meta-label">Eingangsvermerk</p>
                <p className="lawsuit-meta-value">{RAID_URGENCY[request.urgency]}</p>
              </div>
            </div>
          </header>

          <div className="lawsuit-court">
            <p className="lawsuit-court-box">{doc.recipient}</p>
          </div>

          <h1 className="lawsuit-title">Antrag auf richterliche Anordnung</h1>
          <div className="lawsuit-title-rule" />
          <p className="lawsuit-subtitle">Durchsuchung und Beschlagnahme · {doc.dateLine}</p>

          <section className="lawsuit-section">
            <h2 className="lawsuit-heading">Betreff</h2>
            <p className="lawsuit-subject">{doc.subject}</p>
          </section>

          <section className="lawsuit-section">
            <div className="lawsuit-prose">
              <p>{doc.salutation}</p>
              <p>{doc.preamble}</p>
            </div>
          </section>

          {doc.sections.map((section) => (
            <section key={section.heading} className="lawsuit-section">
              <h2 className="lawsuit-heading">{section.heading}</h2>
              <div className="lawsuit-prose">
                {section.paragraphs.map((paragraph, index) => <p key={index} className="whitespace-pre-line">{paragraph}</p>)}
                {section.list && section.list.length > 0 && (section.numbered
                  ? <ol>{section.list.map((item) => <li key={item}>{item}</li>)}</ol>
                  : <ul>{section.list.map((item) => <li key={item}>{item}</li>)}</ul>)}
              </div>
            </section>
          ))}

          <section className="lawsuit-section">
            <div className="lawsuit-prose">
              {doc.closing.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          </section>

          <hr className="lawsuit-divider" />
          <p className="lawsuit-place-date">{doc.dateLine}</p>

          <div className="lawsuit-signatures">
            <div>
              <div className="lawsuit-signature-name lawsuit-signature-script">{request.applicantName}</div>
              <div className="lawsuit-signature-line">{doc.signature.join(' · ')}</div>
            </div>
            <div>
              <div className="lawsuit-signature-name" />
              <div className="lawsuit-signature-line">Entscheidung des Gerichts</div>
            </div>
          </div>

          <footer className="lawsuit-footer">
            <span>{DEPARTMENT_NAME} · {DIVISION_NAME}</span>
            <span>{doc.reference} · Razzia-Antrag</span>
          </footer>
        </div>

        <div className="lawsuit-seal" aria-hidden="true">
          <span className="lawsuit-seal-top">{DEPARTMENT_NAME}</span>
          <span className="lawsuit-seal-main">{urgent ? RAID_URGENCY[request.urgency] : 'Beantragt'}</span>
          <span className="lawsuit-seal-date">{createdAt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
          <span className="lawsuit-seal-top">Los Santos</span>
        </div>
      </article>
    </>
  )
}
