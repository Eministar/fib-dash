import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requirePermission } from '@/lib/auth'
import { success, error, unauthorized } from '@/lib/api-response'
import { createAuditLog } from '@/lib/audit'
import {
  contractSelect,
  createContractForAgent,
  openContractWhere,
  sendContractMessage,
} from '@/lib/contract-service'
import { cleanContractText, isContractStatus } from '@/lib/contracts'

export async function GET(req: NextRequest) {
  try {
    await requirePermission(['contracts:view', 'contracts:manage'])

    const statusParam = req.nextUrl.searchParams.get('status')
    const agentId = req.nextUrl.searchParams.get('agentId')
    const openOnly = req.nextUrl.searchParams.get('open') === 'true'

    const kind = req.nextUrl.searchParams.get('kind')

    const where: Prisma.ContractWhereInput = {}
    if (agentId) where.agentId = agentId
    if (kind === 'AGENT' || kind === 'AGENCY') where.kind = kind
    if (isContractStatus(statusParam)) where.status = statusParam
    else if (openOnly) where.status = { in: ['DRAFT', 'SENT'] }

    const contracts = await prisma.contract.findMany({
      where,
      select: contractSelect,
      orderBy: [{ createdAt: 'desc' }],
      take: 500,
    })

    return success(contracts)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 500)
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('contracts:manage')
    const body = await req.json()

    const agentId = cleanContractText(body.agentId, 40)
    if (!agentId) return error('Agent ist erforderlich')

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        badgeNumber: true,
        discordId: true,
        hireDate: true,
        unit: true,
        units: true,
        rank: { select: { name: true } },
      },
    })
    if (!agent) return error('Agent nicht gefunden', 404)

    const applicationId = cleanContractText(body.applicationId, 40) || null
    if (applicationId) {
      const application = await prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { id: true },
      })
      if (!application) return error('Bewerbung nicht gefunden', 404)
    }

    // Doppelklick-/Doppelanfrage-Schutz: solange ein offener Vertrag existiert,
    // wird dieser erneut zugestellt statt ein zweiter angelegt. Sonst hätte ein
    // Agent mehrere gültige Links und HR eine unklare Aktenlage.
    const existingOpen = await prisma.contract.findFirst({
      where: openContractWhere(agent.id),
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (existingOpen) {
      const { contract: resent, result } = await sendContractMessage(existingOpen.id, { req })
      return success({ ...resent, delivery: result, reused: true }, 200)
    }

    const contract = await createContractForAgent({
      agent,
      templateId: cleanContractText(body.templateId, 40) || null,
      applicationId,
      createdById: user.id,
      title: typeof body.title === 'string' ? body.title : null,
    })

    await createAuditLog({
      action: 'CONTRACT_CREATED',
      userId: user.id,
      agentId: agent.id,
      newValue: contract.title,
    })

    // `send: false` erlaubt es, einen Vertrag vorzubereiten und erst später
    // über „Vertragsnachricht senden“ zuzustellen.
    if (body.send === false) return success(contract, 201)

    // Der Vertrag existiert an dieser Stelle bereits. Ein fehlgeschlagener
    // Versand darf deshalb NICHT zu einem Fehler führen — sonst würde ein
    // Wiederholungsversuch einen zweiten Vertrag anlegen. Der Fehler wird am
    // Datensatz protokolliert und mitgeliefert.
    try {
      const { contract: sent, result } = await sendContractMessage(contract.id, { req })
      return success({ ...sent, delivery: result }, 201)
    } catch (sendError: unknown) {
      const message = sendError instanceof Error ? sendError.message : 'Versand fehlgeschlagen'
      await prisma.contract.update({
        where: { id: contract.id },
        data: { lastSendError: message },
      })
      return success({
        ...contract,
        lastSendError: message,
        delivery: { delivered: false, via: null, channelId: null, messageId: null, error: message },
      }, 201)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return error('Keine Berechtigung', 403)
    return error(msg, 400)
  }
}
