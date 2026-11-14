'use client'

import { useMemo } from 'react'
import { useFetch } from '@/hooks/use-fetch'
import type { ShareKind } from '@/lib/investigations/record-share-kinds'
import { BinderViewer, splitText, type A4Block, type A4Section } from './a4-pages'

export type SharedItem = { kind: ShareKind; recordId: string; title: string }
type Charge = { ref: string; label: string; title: string; text: string | null; url: string | null }
export type SharedDetail = SharedItem & {
  label: string
  reference: string | null
  createdAt: string | null
  fields: { label: string; value: string }[]
  entries: { title: string; content: string | null; occurredAt: string; kind: string; location: string | null }[]
  charges: Charge[]
  photos: { id: string; title: string }[]
  related: (SharedItem & { label: string })[]
  hasPhoto: boolean
  hasVideo: boolean
}

/** Einzahl der Aktenart für Deckblatt und Ordnerrücken. */
export const KIND_NAMES: Record<ShareKind, string> = {
  DOSSIER: 'Familienakte',
  CASE: 'Einsatzakte',
  PERSON: 'Personenakte',
  VEHICLE: 'Fahrzeugakte',
  CLIP: 'Bodycam-Aufnahme',
}
/** Ordnerfarben je Aktenart – gedeckt wie echte Ordner. */
export const KIND_COLORS: Record<ShareKind, string> = {
  DOSSIER: '#2f5d46',
  CASE: '#2c4a73',
  PERSON: '#7a2e35',
  VEHICLE: '#4a5563',
  CLIP: '#3b3b44',
}

const dateTime = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const date = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
const LONG_FIELD = 90

function Letterhead({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'a4-mark' : 'a4-letterhead'}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shield.webp" alt="" aria-hidden />
      <div>
        <p className="a4-dept">Federal Investigation Bureau</p>
        <p className="a4-division">Ermittlungsabteilung · Los Santos</p>
      </div>
    </div>
  )
}

export function PageHeader({ reference, label }: { reference: string; label: string }) {
  return (
    <>
      <Letterhead small />
      <div className="a4-header-meta">
        <span>{label}</span>
        <strong>{reference}</strong>
      </div>
    </>
  )
}

/** Abschnitte eines freigegebenen Eintrags. */
function recordSections(detail: SharedDetail, mediaUrl: (photoId?: string) => string, clipUrl: (id: string) => string, onOpen: (item: SharedItem) => void): A4Section[] {
  const kind = KIND_NAMES[detail.kind]
  const reference = detail.reference ?? detail.title.split(' · ')[0]
  const heading = detail.reference && detail.title.startsWith(`${detail.reference} · `) ? detail.title.slice(detail.reference.length + 3) : detail.title
  const status = detail.fields.find((field) => field.label === 'Status')?.value
  const sections: A4Section[] = []

  sections.push({
    id: 'cover',
    title: 'Deckblatt',
    bare: true,
    blocks: [{
      key: 'cover',
      node: (
        <div className="a4-cover">
          <Letterhead />
          <div className="a4-cover-main">
            <p className="a4-cover-kind">{kind}</p>
            {detail.reference && <p className="a4-cover-ref">{detail.reference}</p>}
            <h1 className="a4-cover-title">{heading}</h1>
            <div className="a4-cover-rule" />
            <dl className="a4-cover-meta">
              {detail.createdAt && <div><dt>{detail.kind === 'CLIP' ? 'Aufgenommen' : 'Angelegt'}</dt><dd>{date.format(new Date(detail.createdAt))}</dd></div>}
              {status && <div><dt>Status</dt><dd>{status}</dd></div>}
              {detail.charges.length > 0 && <div><dt>Straftatbestände</dt><dd>{detail.charges.map((charge) => charge.label).join(' · ')}</dd></div>}
              {detail.entries.length > 0 && <div><dt>Chronologie</dt><dd>{detail.entries.length} Einträge</dd></div>}
              {detail.photos.length > 0 && <div><dt>Lichtbilder</dt><dd>{detail.photos.length}</dd></div>}
            </dl>
          </div>
          {detail.photos[0] && (
            <figure className="a4-cover-photo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(detail.photos[0].id)} alt={detail.photos[0].title || 'Lichtbild'} />
              <figcaption>Lichtbild 1{detail.photos[0].title ? ` · ${detail.photos[0].title}` : ''}</figcaption>
            </figure>
          )}
          <div className="a4-stamp" aria-hidden>
            <span>Freigegeben</span>
            <small>zur Einsicht</small>
          </div>
          <p className="a4-cover-foot">{reference} · {kind} · Nur für den bestimmungsgemäßen Gebrauch</p>
        </div>
      ),
    }],
  })

  const short = detail.fields.filter((field) => field.label !== 'Status' && field.value.length <= LONG_FIELD && !field.value.includes('\n'))
  const long = detail.fields.filter((field) => !short.includes(field) && field.label !== 'Status')
  const facts: A4Block[] = []
  if (status || short.length) {
    facts.push({
      key: 'facts-table',
      node: (
        <table className="a4-table">
          <tbody>
            {[...(status ? [{ label: 'Status', value: status }] : []), ...short].map((field) => (
              <tr key={field.label}><th>{field.label}</th><td>{field.value}</td></tr>
            ))}
          </tbody>
        </table>
      ),
    })
  }
  for (const field of long) {
    facts.push({ key: `field-${field.label}`, keepWithNext: true, node: <h3 className="a4-subhead">{field.label}</h3> })
    splitText(field.value).forEach((part, index) => facts.push({ key: `field-${field.label}-${index}`, node: <p className="a4-text">{part}</p> }))
  }
  if (facts.length) sections.push({ id: 'facts', title: detail.kind === 'CASE' ? 'Sachstand' : 'Stammdaten', blocks: facts })

  if (detail.charges.length) {
    sections.push({
      id: 'charges',
      title: 'Straftatbestände',
      blocks: [
        { key: 'charges-intro', node: <p className="a4-text a4-muted">Nach dem Stand der Ermittlungen wurde gegen folgende Normen des Gesetzbuchs von Nerowood verstoßen (Quelle: Federal Justice Department).</p> },
        ...detail.charges.flatMap((charge): A4Block[] => [
          { key: `charge-${charge.ref}`, keepWithNext: true, node: <h3 className="a4-norm"><span>{charge.label}</span>{charge.title}</h3> },
          ...splitText(charge.text ?? 'Normtext derzeit nicht abrufbar.', 700).map((part, index) => ({ key: `charge-${charge.ref}-${index}`, node: <p className="a4-text a4-norm-text">{part}</p> })),
        ]),
      ],
    })
  }

  if (detail.entries.length) {
    const chronological = [...detail.entries].reverse()
    sections.push({
      id: 'chronology',
      title: 'Chronologie',
      blocks: chronological.flatMap((entry, number): A4Block[] => {
        const parts = splitText(entry.content ?? '', 620)
        const head = (
          <div className="a4-entry-head">
            <span className="a4-entry-no">{number + 1}</span>
            <div>
              <p className="a4-entry-meta">{dateTime.format(new Date(entry.occurredAt))} · {entry.kind}{entry.location ? ` · ${entry.location}` : ''}</p>
              <h3 className="a4-entry-title">{entry.title}</h3>
            </div>
          </div>
        )
        if (!parts.length) return [{ key: `entry-${number}`, node: <div className="a4-entry">{head}</div> }]
        return parts.map((part, index) => ({
          key: `entry-${number}-${index}`,
          node: index === 0
            ? <div className="a4-entry">{head}<p className="a4-text a4-entry-text">{part}</p></div>
            : <div className="a4-entry a4-entry-cont"><p className="a4-text a4-entry-text">{part}</p></div>,
        }))
      }),
    })
  }

  const photos = detail.photos
  if (photos.length) {
    sections.push({
      id: 'photos',
      title: 'Lichtbilder',
      blocks: photos.map((photo, index) => ({
        key: `photo-${photo.id}`,
        node: (
          <figure className="a4-photo">
            <a href={mediaUrl(photo.id)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaUrl(photo.id)} alt={photo.title || `Lichtbild ${index + 1}`} loading="lazy" />
            </a>
            <figcaption>Lichtbild {index + 1}{photo.title ? ` · ${photo.title}` : ''}</figcaption>
          </figure>
        ),
      })),
    })
  }

  const clips = [
    ...(detail.hasVideo ? [{ key: 'own', title: heading, src: mediaUrl() }] : []),
    ...detail.related.filter((rel) => rel.kind === 'CLIP').map((clip) => ({ key: clip.recordId, title: clip.title, src: clipUrl(clip.recordId) })),
  ]
  if (clips.length) {
    sections.push({
      id: 'video',
      title: 'Bodycam',
      blocks: clips.map((clip, index) => ({
        key: `clip-${clip.key}`,
        node: (
          <figure className="a4-video">
            <video controls playsInline preload="none" src={clip.src} />
            <figcaption>Aufnahme {index + 1} · {clip.title}</figcaption>
          </figure>
        ),
      })),
    })
  }

  const related = detail.related.filter((rel) => rel.kind !== 'CLIP')
  if (related.length) {
    sections.push({
      id: 'related',
      title: 'Verknüpfte Akten',
      blocks: [
        { key: 'related-intro', node: <p className="a4-text a4-muted">Diese Akten liegen ebenfalls in der Freigabe. Ein Klick öffnet den jeweiligen Ordner.</p> },
        ...related.map((rel) => ({
          key: `rel-${rel.kind}-${rel.recordId}`,
          node: (
            <button type="button" className="a4-link-row" onClick={() => onOpen(rel)}>
              <span className="a4-link-kind" style={{ background: KIND_COLORS[rel.kind] }}>{rel.label}</span>
              <span className="a4-link-title">{rel.title}</span>
              <span aria-hidden>→</span>
            </button>
          ),
        })),
      ],
    })
  }
  return sections
}

/** Freigegebener Eintrag als Aktenordner. */
export function RecordBinder({ token, item, onClose, onOpen }: { token: string; item: SharedItem; onClose: () => void; onOpen: (item: SharedItem) => void }) {
  const url = `/api/shared-records/${encodeURIComponent(token)}/${item.kind}/${encodeURIComponent(item.recordId)}`
  const { data, error } = useFetch<SharedDetail>(url, 10 * 60_000)
  const sections = useMemo(() => data ? recordSections(
    data,
    (photoId) => (photoId ? `${url}/media?photo=${encodeURIComponent(photoId)}` : `${url}/media`),
    (id) => `/api/shared-records/${encodeURIComponent(token)}/CLIP/${encodeURIComponent(id)}/media`,
    onOpen,
  ) : [], [data, url, token, onOpen])

  if (error) {
    return (
      <div className="binder-viewer" role="dialog" aria-modal="true">
        <div className="binder-toolbar"><h2 className="binder-title">{item.title}</h2><button type="button" className="binder-tool" onClick={onClose}>Schließen</button></div>
        <p className="binder-loading">Dieser Eintrag ist nicht mehr verfügbar oder nicht mehr freigegeben.</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="binder-viewer" role="dialog" aria-modal="true" aria-busy>
        <p className="binder-loading">Ordner wird geöffnet …</p>
      </div>
    )
  }
  const reference = data.reference ?? data.title.split(' · ')[0]
  return (
    <BinderViewer
      key={`${item.kind}:${item.recordId}`}
      title={data.title}
      eyebrow={KIND_NAMES[data.kind]}
      color={KIND_COLORS[data.kind]}
      sections={sections}
      header={<PageHeader reference={reference} label={KIND_NAMES[data.kind]} />}
      footer={`FIB · ${KIND_NAMES[data.kind]} ${reference}`}
      onClose={onClose}
    />
  )
}
