import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import { sendContractMessage } from '@/lib/contract-service'
import { cleanContractLongText } from '@/lib/contracts'

/**
 * „Vertragsnachricht senden“ — verschickt den persönlichen Vertragslink erneut
 * per Discord-DM (mit Channel-Fallback). Nutzbar, solange der Vertrag offen ist.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission('contracts:manage')
    const { id } = await params

    let note: string | null = null
    try {
      const body = await req.json()
      note = cleanContractLongText(body?.note, 500) || null
    } catch {
      // Kein Body — nur Standardnachricht senden.
    }

    const { contract, result } = await sendContractMessage(id, { req, note })

    await createAuditLog({
      action: 'CONTRACT_MESSAGE_SENT',
      userId: user.id,
      agentId: contract.agentId ?? undefined,
      newValue: result.delivered ? `Zugestellt (${result.via === 'dm' ? 'DM' : 'Channel'})` : 'Nicht zugestellt',
      details: result.error ?? contract.title,
    })

    if (!result.delivered) {
      return error(result.error ?? 'Vertragsnachricht konnte nicht zugestellt werden', 502)
    }

    return success({ ...contract, delivery: result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 400)
  }
}
