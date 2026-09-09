import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { error, unauthorized } from '@/lib/api-response'
import { getDutyTimesSnapshot, formatDuration } from '@/lib/duty-times'
import { formatDate, formatDateTime } from '@/lib/utils'
import { displayBadgeNumber } from '@/lib/badge-number'
import { penalGradeLabel, resolveViolation, sanctionLevelLabel } from '@/lib/sanction-catalog'
import { withAgentTrainingRows } from '@/lib/agent-trainings'
import { PROBATION_STATUS_LABELS, PROBATION_TYPE_LABELS } from '@/lib/probations'

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function csv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

function response(body: string, filename: string, contentType: string) {
  return new NextResponse(body, {
    headers: {
      'content-type': `${contentType}; charset=utf-8`,
      'content-disposition': `attachment; filename="${filename}"`,
    },
  })
}

function html(title: string, rows: Array<[string, string]>, sections: Array<{ title: string; rows: string[][] }> = []) {
  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
body{font-family:Arial,sans-serif;color:#181818;margin:32px}
h1{font-size:24px;margin:0 0 20px}
h2{font-size:16px;margin:28px 0 10px}
dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px}
dt{font-weight:700;color:#404040}
dd{margin:0}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #d5d5d5;padding:7px;text-align:left;vertical-align:top}
th{background:#f4f4f4}
@media print{body{margin:16mm}.no-print{display:none}}
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">Als PDF drucken</button>
<h1>${esc(title)}</h1>
<dl>${rows.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
${sections.map((section) => `<h2>${esc(section.title)}</h2><table>${section.rows.map((row, index) => `<tr>${row.map((cell) => index === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</table>`).join('')}
</body>
</html>`
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('exports:view')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }

  const type = req.nextUrl.searchParams.get('type') ?? 'agents'
  const format = req.nextUrl.searchParams.get('format') ?? 'csv'
  const nowLabel = new Date().toISOString().slice(0, 10)

  if (type === 'agents') {
    const agents = await prisma.agent.findMany({
      include: { rank: true },
      orderBy: [{ rank: { sortOrder: 'asc' } }, { badgeNumber: 'asc' }],
    })
    const rows = [
      ['Dienstnummer', 'Name', 'Rang', 'Status', 'Discord-ID', 'Einstellung', 'Letzte Aktivität'],
      ...agents.map((agent) => [
        displayBadgeNumber(agent.badgeNumber),
        `${agent.firstName} ${agent.lastName}`,
        agent.rank.name,
        agent.status,
        agent.discordId ?? '',
        formatDate(agent.hireDate),
        formatDateTime(agent.lastOnline),
      ]),
    ]
    return response(csv(rows), `agents-${nowLabel}.csv`, 'text/csv')
  }

  if (type === 'duty-week') {
    const snapshot = await getDutyTimesSnapshot()
    const rows = [
      ['Dienstnummer', 'Name', 'Rang', 'Status', 'Woche', 'Sessions', 'Letzte Aktivität'],
      ...snapshot.rows.map((row) => [
        displayBadgeNumber(row.badgeNumber),
        `${row.firstName} ${row.lastName}`,
        row.rank.name,
        row.apiStatus,
        formatDuration(row.weekDurationMs),
        row.sessionCount,
        formatDateTime(row.lastSeenAt),
      ]),
    ]
    return response(csv(rows), `dienstzeiten-${nowLabel}.csv`, 'text/csv')
  }

  if (type === 'sanctions') {
    const sanctions = await prisma.sanction.findMany({
      include: { agent: { include: { rank: true } }, issuedBy: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const rows = [
      ['Datum', 'Agent', 'Dienstnummer', 'Rang', 'Penal Grade', 'Status', 'Sanktionsstufe', 'Verstoß', 'Weitere Folge', 'Suspendiert bis', 'Grund', 'Ausgestellt von'],
      ...sanctions.map((sanction) => [
        formatDateTime(sanction.createdAt),
        sanction.agent ? `${sanction.agent.firstName} ${sanction.agent.lastName}` : `${sanction.previousFirstName ?? ''} ${sanction.previousLastName ?? ''}`.trim(),
        displayBadgeNumber(sanction.agent?.badgeNumber ?? sanction.previousBadgeNumber),
        sanction.agent?.rank.name ?? sanction.previousRank ?? '',
        penalGradeLabel(sanction.penalGrade),
        sanction.status,
        sanctionLevelLabel(sanction.level),
        resolveViolation(sanction.violationCode)?.label ?? '',
        sanction.penalty ?? '',
        formatDateTime(sanction.suspendedUntil),
        sanction.reason,
        sanction.issuedBy?.displayName ?? '',
      ]),
    ]
    return response(csv(rows), `sanktionen-${nowLabel}.csv`, 'text/csv')
  }

  if (type === 'promotions') {
    const logs = await prisma.promotionLog.findMany({
      include: { agent: true, oldRank: true, newRank: true, performedBy: { select: { displayName: true } } },
      orderBy: { createdAt: 'desc' },
    })
    const rows = [
      ['Datum', 'Agent', 'Alte DN', 'Neue DN', 'Alter Rang', 'Neuer Rang', 'Notiz', 'Durchgeführt von'],
      ...logs.map((log) => [
        formatDateTime(log.createdAt),
        `${log.agent.firstName} ${log.agent.lastName}`,
        displayBadgeNumber(log.oldBadgeNumber),
        displayBadgeNumber(log.newBadgeNumber),
        log.oldRank.name,
        log.newRank.name,
        log.note ?? '',
        log.performedBy?.displayName ?? '',
      ]),
    ]
    return response(csv(rows), `rangwechsel-${nowLabel}.csv`, 'text/csv')
  }

  if (type === 'agent') {
    const agentId = req.nextUrl.searchParams.get('agentId') ?? ''
    const [agent, trainings] = await Promise.all([
      prisma.agent.findUnique({
        where: { id: agentId },
        include: {
          rank: true,
          trainings: { include: { training: { include: { minRank: true } } } },
          sanctions: true,
          promotionLogs: { include: { oldRank: true, newRank: true } },
          agentNotes: true,
          probations: {
            include: { entries: true },
            orderBy: { startsAt: 'desc' },
          },
        },
      }),
      prisma.training.findMany({
        include: { minRank: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ])
    if (!agent) return error('Agent nicht gefunden', 404)
    const agentWithTrainingRows = withAgentTrainingRows(agent, trainings)

    if (format === 'html') {
      const latestProbation = agent.probations[0]
      return new NextResponse(html(
        `Agent-Akte ${agent.firstName} ${agent.lastName}`,
        [
          ['Name', `${agent.firstName} ${agent.lastName}`],
          ['Dienstnummer', displayBadgeNumber(agent.badgeNumber)],
          ['Rang', agent.rank.name],
          ['Status', agent.status],
          ['Einstellung', formatDate(agent.hireDate)],
          ['Discord-ID', agent.discordId ?? ''],
          ['Probezeit', latestProbation ? `${PROBATION_TYPE_LABELS[latestProbation.type]} / ${PROBATION_STATUS_LABELS[latestProbation.status]} bis ${formatDate(latestProbation.endsAt)}` : 'Keine'],
        ],
        [
          {
            title: 'Probezeiten',
            rows: [
              ['Typ', 'Status', 'Zeitraum', 'Positiv', 'Negativ', 'Ergebnis'],
              ...agent.probations.map((item) => {
                const positive = item.entries.filter((entry) => entry.rating === 'POSITIVE').length
                const negative = item.entries.filter((entry) => entry.rating === 'NEGATIVE').length
                return [
                  PROBATION_TYPE_LABELS[item.type],
                  PROBATION_STATUS_LABELS[item.status],
                  `${formatDate(item.startsAt)} bis ${formatDate(item.endsAt)}`,
                  String(positive),
                  String(negative),
                  item.resultNote ?? '',
                ]
              }),
            ],
          },
          { title: 'Ausbildungen', rows: [['Ausbildung', 'Status'], ...agentWithTrainingRows.trainings.map((item) => [item.training.label, item.completed ? 'Abgeschlossen' : 'Offen'])] },
          { title: 'Rangverlauf', rows: [['Datum', 'Von', 'Nach', 'Notiz'], ...agent.promotionLogs.map((item) => [formatDateTime(item.createdAt), item.oldRank.name, item.newRank.name, item.note ?? ''])] },
          { title: 'Sanktionen', rows: [['Datum', 'Grade', 'Status', 'Sanktionsstufe', 'Verstoß', 'Grund'], ...agent.sanctions.map((item) => [formatDateTime(item.createdAt), penalGradeLabel(item.penalGrade), item.status, sanctionLevelLabel(item.level), resolveViolation(item.violationCode)?.label ?? '', item.reason])] },
          { title: 'Notizen', rows: [['Datum', 'Titel', 'Inhalt'], ...agent.agentNotes.map((item) => [formatDateTime(item.createdAt), item.title ?? '', item.content])] },
        ],
      ), { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    const rows = [
      ['Feld', 'Wert'],
      ['Name', `${agent.firstName} ${agent.lastName}`],
      ['Dienstnummer', displayBadgeNumber(agent.badgeNumber)],
      ['Rang', agent.rank.name],
      ['Status', agent.status],
      ['Einstellung', formatDate(agent.hireDate)],
      ['Discord-ID', agent.discordId ?? ''],
    ]
    return response(csv(rows), `agent-${displayBadgeNumber(agent.badgeNumber)}-${nowLabel}.csv`, 'text/csv')
  }

  return error('Export-Typ ist ungültig')
}
