/**
 * Razzia-Antrag (Antrag auf Durchsuchungs- und Beschlagnahmebeschluss) als
 * Anschreiben zu einem Freigabelink. Die Akten des Links sind die Anlagen.
 * Reine Logik ohne zod: der förmliche Text, den Dashboard-Vorschau und
 * öffentliche Leseansicht gleich darstellen. Die Prüfung liegt in
 * `raid-request-schema`, damit die öffentliche Seite schlank bleibt.
 */
export const RAID_MEASURES = {
  SEARCH_PREMISES: 'Durchsuchung der bezeichneten Räumlichkeiten einschließlich aller Neben- und Kellerräume, Garagen und umfriedeten Flächen',
  SEARCH_VEHICLES: 'Durchsuchung sämtlicher auf dem Grundstück befindlicher oder den Betroffenen zuzuordnender Fahrzeuge',
  SEARCH_PERSONS: 'Durchsuchung der bei Durchführung der Maßnahme angetroffenen Personen',
  SEIZE_EVIDENCE: 'Beschlagnahme sämtlicher als Beweismittel in Betracht kommender Gegenstände, Unterlagen und Datenträger',
  SEIZE_WEAPONS: 'Sicherstellung von Waffen, Munition, Betäubungsmitteln sowie sonstigen verbotenen Gegenständen',
  SEIZE_ASSETS: 'Sicherstellung von Vermögenswerten, die aus den bezeichneten Taten herrühren',
  ARREST: 'Vorläufige Festnahme der Tatverdächtigen bei Antreffen',
  TACTICAL: 'Hinzuziehung taktischer Einsatzkräfte (S.R.U.) zur Sicherung der Maßnahme',
} as const
export type RaidMeasure = keyof typeof RAID_MEASURES

export const RAID_URGENCY = {
  REGULAR: 'Regulär',
  URGENT: 'Dringend',
  IMMINENT: 'Gefahr im Verzug',
} as const
export type RaidUrgency = keyof typeof RAID_URGENCY

/** Eingaben des Antrags; geprüft wird in `raid-request-schema` (zod nur auf dem Server und im Formular). */
export type RaidRequest = {
  recipient: string
  target: string
  address: string
  suspects: string
  offenses: string
  facts: string
  measures: RaidMeasure[]
  urgency: RaidUrgency
  window: string
  applicantName: string
  applicantRank: string
  applicantBadge: string
}

export const emptyRaidRequest = (applicantName = ''): RaidRequest => ({
  recipient: 'Department of Justice – Zuständige Kammer für Ermittlungsrichterliche Maßnahmen',
  target: '',
  address: '',
  suspects: '',
  offenses: '',
  facts: '',
  measures: ['SEARCH_PREMISES', 'SEIZE_EVIDENCE'],
  urgency: 'REGULAR',
  window: 'binnen 72 Stunden ab Erlass des Beschlusses',
  applicantName,
  applicantRank: '',
  applicantBadge: '',
})

/** Aktenzeichen des Antrags, abgeleitet aus Datum und Freigabe – stabil und ohne Zähler. */
export function raidReference(shareId: string, createdAt: Date) {
  const y = createdAt.getFullYear()
  const md = `${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`
  return `FIB-RA-${y}-${md}-${shareId.slice(-5).toUpperCase()}`
}

export type RaidAttachment = { label: string; title: string }

export type RaidDocument = {
  reference: string
  dateLine: string
  recipient: string
  subject: string
  salutation: string
  preamble: string
  sections: { heading: string; paragraphs: string[]; list?: string[]; numbered?: boolean }[]
  closing: string
  signature: string[]
}

function paragraphs(value: string) {
  return value.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

/** Der förmliche Antragstext. Die Formulierungen sind bewusst getragen und hoheitlich. */
export function raidDocument(request: RaidRequest, meta: { reference: string; createdAt: Date; attachments: RaidAttachment[] }): RaidDocument {
  const applicant = [request.applicantRank, request.applicantName].filter(Boolean).join(' ')
  const badge = request.applicantBadge ? ` (Dienstnummer ${request.applicantBadge})` : ''
  const place = request.address ? `${request.target}, belegen ${request.address}` : request.target

  const sections: RaidDocument['sections'] = [
    {
      heading: 'I. Antrag',
      paragraphs: [
        `Es wird beantragt, die nachfolgend bezeichneten Maßnahmen hinsichtlich des Objekts „${place}“ ${request.window ? `${request.window} ` : ''}anzuordnen und das Federal Investigation Bureau mit deren Durchführung zu betrauen:`,
      ],
      list: request.measures.map((key) => RAID_MEASURES[key]),
      numbered: true,
    },
    {
      heading: 'II. Betroffene',
      paragraphs: request.suspects ? paragraphs(request.suspects) : ['Die Maßnahme richtet sich gegen die Verfügungsberechtigten des bezeichneten Objekts sowie gegen dort angetroffene Tatverdächtige.'],
    },
    {
      heading: 'III. Tatvorwurf',
      paragraphs: [
        'Die Betroffenen sind nach dem gegenwärtigen Stand der Ermittlungen folgender Straftaten dringend verdächtig:',
        ...paragraphs(request.offenses),
      ],
    },
    {
      heading: 'IV. Sachverhalt',
      paragraphs: paragraphs(request.facts),
    },
    {
      heading: 'V. Beweismittel',
      paragraphs: meta.attachments.length
        ? ['Zur Glaubhaftmachung wird auf die nachfolgenden, diesem Antrag als Anlagen beigefügten Ermittlungsunterlagen des Federal Investigation Bureau Bezug genommen:']
        : ['Die zugrunde liegenden Ermittlungsunterlagen werden auf Anforderung vorgelegt.'],
      list: meta.attachments.map((item, index) => `Anlage ${index + 1}: ${item.label} – ${item.title}`),
    },
    {
      heading: 'VI. Rechtliche Würdigung und Verhältnismäßigkeit',
      paragraphs: [
        'Aufgrund der dargelegten Tatsachen ist zu vermuten, dass die Durchsuchung zur Auffindung von Beweismitteln führen wird, die für die Untersuchung von Bedeutung sind. Mildere, gleich geeignete Mittel stehen nicht zur Verfügung; insbesondere ist zu befürchten, dass Beweismittel bei offener Befragung oder Vorladung beiseitegeschafft oder vernichtet würden.',
        'Die beantragten Maßnahmen stehen in einem angemessenen Verhältnis zur Schwere der Tatvorwürfe und zur Stärke des Tatverdachts. Das öffentliche Interesse an der Aufklärung der bezeichneten Straftaten überwiegt das Interesse der Betroffenen an der Unverletzlichkeit ihrer Räumlichkeiten.',
      ],
    },
  ]

  if (request.urgency !== 'REGULAR') {
    sections.push({
      heading: 'VII. Eilbedürftigkeit',
      paragraphs: [request.urgency === 'IMMINENT'
        ? 'Es besteht Gefahr im Verzug. Jede weitere Verzögerung würde den Erfolg der Maßnahme ernsthaft gefährden, da mit dem unmittelbaren Verlust der Beweismittel zu rechnen ist. Um umgehende Entscheidung, nötigenfalls fernmündlich, wird ersucht.'
        : 'Der Antrag ist dringlich. Um vorrangige Bearbeitung und Entscheidung wird höflichst ersucht.'],
    })
  }

  return {
    reference: meta.reference,
    dateLine: `Los Santos, den ${dateFormat.format(meta.createdAt)}`,
    recipient: request.recipient,
    subject: `Antrag auf Erlass eines Durchsuchungs- und Beschlagnahmebeschlusses – ${request.target}`,
    salutation: 'Sehr geehrte Damen und Herren, Hohes Gericht,',
    preamble: `kraft der mir als ${applicant || 'Bediensteter'}${badge} des Federal Investigation Bureau verliehenen Befugnisse und im Namen des Federal Investigation Bureau stelle ich hiermit förmlich den folgenden Antrag und ersuche um richterliche Anordnung der nachstehend bezeichneten Maßnahmen.`,
    sections,
    closing: 'Für die Richtigkeit und Vollständigkeit der vorstehenden Angaben stehe ich mit meinem Amt ein. Für Rückfragen sowie zur ergänzenden Vorlage weiterer Unterlagen steht das Federal Investigation Bureau jederzeit zur Verfügung.\n\nHochachtungsvoll',
    signature: [
      applicant || request.applicantName,
      ...(request.applicantBadge ? [`Dienstnummer ${request.applicantBadge}`] : []),
      'Federal Investigation Bureau',
    ],
  }
}
