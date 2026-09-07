import { NextRequest } from 'next/server'
import { error, success, unauthorized , forbidden } from '@/lib/api-response'
import { runAgentStatusAutomation } from '@/lib/absence-status'
import { syncDiscordAbsenceStatusMessage, syncDiscordDutyStatusMessage } from '@/lib/discord-integration'
import { queueDiscordWebhookEvent } from '@/lib/discord-webhook'
import { runSanctionDeadlineAutomation } from '@/lib/sanctions'
import { runAuditLogCleanup } from '@/lib/audit-log-retention'

export const runtime = 'nodejs'

function automationToken() {
  return process.env.STATUS_AUTOMATION_TOKEN?.trim() || process.env.FIB_STATUS_AUTOMATION_TOKEN?.trim() || ''
}

export async function POST(req: NextRequest) {
  const token = automationToken()
  if (token) {
    const header = req.headers.get('authorization')?.trim() || ''
    const incoming = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header
    if (incoming !== token) return unauthorized()
  }

  try {
    const [result, sanctionResult, auditLogCleanup] = await Promise.all([
      runAgentStatusAutomation({ force: true }),
      runSanctionDeadlineAutomation(),
      runAuditLogCleanup(),
    ])
    const panelResults = await Promise.allSettled([
      syncDiscordAbsenceStatusMessage(),
      syncDiscordDutyStatusMessage(),
    ])
    panelResults.forEach((item, index) => {
      if (item.status === 'rejected') {
        queueDiscordWebhookEvent({
          title: 'Discord-Panel-Aktualisierung fehlgeschlagen',
          severity: 'error',
          source: 'status-automation',
          fields: [{ name: 'Panel', value: index === 0 ? 'Abmeldungen' : 'Dienstzeiten', inline: true }],
          error: item.reason,
        })
      }
    })
    return success({
      ...result,
      ...sanctionResult,
      auditLogCleanup,
      panelsUpdated: panelResults.filter((item) => item.status === 'fulfilled').length,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    return error(msg, 500)
  }
}
