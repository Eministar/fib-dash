'use client'

import { useMemo } from 'react'
import { raidDocument, RAID_URGENCY, type RaidRequest } from '@/lib/investigations/raid-request'
import { SHARE_KINDS } from '@/lib/investigations/record-share-kinds'
import { BinderViewer, splitText, type A4Block, type A4Section } from './a4-pages'
import { KIND_COLORS, PageHeader, type SharedItem } from './record-binder'

export type RaidShare = {
  request: RaidRequest
  reference: string
  createdAt: string
  laws: { ref: string; label: string; title: string; text: string | null }[]
}

export const RAID_COLOR = '#8a1c1c'

function raidSections(raid: RaidShare, items: SharedItem[], onOpen: (item: SharedItem) => void): A4Section[] {
  const createdAt = new Date(raid.createdAt)
  const doc = raidDocument(raid.request, {
    reference: raid.reference,
    createdAt,
    attachments: items.map((item) => ({ label: SHARE_KINDS[item.kind], title: item.title })),
  })
  const urgent = raid.request.urgency !== 'REGULAR'
  const blocks: A4Block[] = [
    {
      key: 'raid-head',
      node: (
        <div className="a4-raid-head">
          <div className="a4-letterhead">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/shield.webp" alt="" aria-hidden />
            <div>
              <p className="a4-dept">Federal Investigation Bureau</p>
              <p className="a4-division">Ermittlungsabteilung · Elite Street 1 · Nerowood</p>
            </div>
          </div>
          <div className="a4-raid-meta">
            <p><span>Aktenzeichen</span>{doc.reference}</p>
            <p><span>Eingangsvermerk</span>{RAID_URGENCY[raid.request.urgency]}</p>
          </div>
        </div>
      ),
    },
    { key: 'raid-recipient', node: <p className="a4-recipient">{doc.recipient}</p> },
    {
      key: 'raid-title',
      node: (
        <div className="a4-raid-title">
          <h1>Antrag auf richterliche Anordnung</h1>
          <p>Durchsuchung und Beschlagnahme · {doc.dateLine}</p>
        </div>
      ),
    },
    { key: 'raid-subject', node: <p className="a4-text"><strong>Betreff: </strong>{doc.subject}</p> },
    { key: 'raid-salutation', node: <p className="a4-text">{doc.salutation}</p> },
    { key: 'raid-preamble', node: <p className="a4-text">{doc.preamble}</p> },
  ]
  doc.sections.forEach((section, sectionIndex) => {
    blocks.push({ key: `raid-s${sectionIndex}`, keepWithNext: true, node: <h3 className="a4-subhead">{section.heading}</h3> })
    section.paragraphs.forEach((paragraph, paragraphIndex) => {
      splitText(paragraph).forEach((part, partIndex) => blocks.push({ key: `raid-s${sectionIndex}-p${paragraphIndex}-${partIndex}`, node: <p className="a4-text whitespace-pre-line">{part}</p> }))
    })
    section.list?.forEach((item, itemIndex) => blocks.push({
      key: `raid-s${sectionIndex}-l${itemIndex}`,
      node: (
        <p className="a4-text a4-list-item">
          <span>{section.numbered ? `${itemIndex + 1}.` : '–'}</span>
          {item}
        </p>
      ),
    }))
  })
  doc.closing.split('\n\n').forEach((paragraph, index) => blocks.push({ key: `raid-closing-${index}`, node: <p className="a4-text">{paragraph}</p> }))
  blocks.push({
    key: 'raid-signature',
    node: (
      <div className="a4-signatures">
        <div>
          <p className="a4-signature-script">{raid.request.applicantName}</p>
          <p className="a4-signature-line">{doc.signature.join(' · ')}</p>
        </div>
        <div>
          <p className="a4-signature-script" />
          <p className="a4-signature-line">Entscheidung des Gerichts</p>
        </div>
        <div className="a4-seal" aria-hidden>
          <span>Federal Investigation Bureau</span>
          <strong>{urgent ? RAID_URGENCY[raid.request.urgency] : 'Beantragt'}</strong>
          <span>{createdAt.toLocaleDateString('de-DE')}</span>
        </div>
      </div>
    ),
  })

  const sections: A4Section[] = [{ id: 'antrag', title: 'Antrag', blocks, plain: true }]

  if (items.length) {
    sections.push({
      id: 'anlagen',
      title: 'Anlagen',
      blocks: [
        { key: 'att-intro', node: <p className="a4-text a4-muted">Die folgenden Ermittlungsunterlagen sind dem Antrag als Anlagen beigefügt. Ein Klick öffnet den Ordner der jeweiligen Anlage.</p> },
        ...items.map((item, index) => ({
          key: `att-${item.kind}-${item.recordId}`,
          node: (
            <button type="button" className="a4-link-row" onClick={() => onOpen(item)}>
              <span className="a4-link-no">Anlage {index + 1}</span>
              <span className="a4-link-kind" style={{ background: KIND_COLORS[item.kind] }}>{SHARE_KINDS[item.kind]}</span>
              <span className="a4-link-title">{item.title}</span>
              <span aria-hidden>→</span>
            </button>
          ),
        })),
      ],
    })
  }

  if (raid.laws.length) {
    sections.push({
      id: 'gesetze',
      title: 'Gesetzestexte',
      blocks: [
        { key: 'laws-intro', node: <p className="a4-text a4-muted">Wortlaut der vorgeworfenen Normen nach dem Gesetzbuch von Nerowood, wie es das Federal Justice Department veröffentlicht.</p> },
        ...raid.laws.flatMap((law): A4Block[] => [
          { key: `law-${law.ref}`, keepWithNext: true, node: <h3 className="a4-norm"><span>{law.label}</span>{law.title}</h3> },
          ...splitText(law.text ?? 'Normtext derzeit nicht abrufbar.', 700).map((part, index) => ({ key: `law-${law.ref}-${index}`, node: <p className="a4-text a4-norm-text">{part}</p> })),
        ]),
      ],
    })
  }
  return sections
}

export function RaidBinder({ raid, items, onClose, onOpen }: { raid: RaidShare; items: SharedItem[]; onClose: () => void; onOpen: (item: SharedItem) => void }) {
  const sections = useMemo(() => raidSections(raid, items, onOpen), [raid, items, onOpen])
  return (
    <BinderViewer
      title={`Razzia-Antrag · ${raid.request.target}`}
      eyebrow={`Antrag ${raid.reference}`}
      color={RAID_COLOR}
      sections={sections}
      header={<PageHeader reference={raid.reference} label="Razzia-Antrag" />}
      footer={`FIB · Antrag auf Durchsuchung und Beschlagnahme ${raid.reference}`}
      onClose={onClose}
    />
  )
}
