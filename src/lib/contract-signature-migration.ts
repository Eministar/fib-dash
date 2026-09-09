import { prisma } from '@/lib/prisma'

/**
 * Überführt die Unterschriftsdaten bestehender Verträge in das Modell
 * `ContractSignature`. Jeder Vertrag alten Zuschnitts bekommt genau eine
 * Zeile — den Agent, der ihn unterschreibt.
 *
 * Der Token wird **unverändert** übernommen: bereits verschickte Links müssen
 * weiter funktionieren.
 *
 * Wiederholbar: Verträge, die schon eine Zeile haben, werden übersprungen.
 * Gibt die Zahl der angelegten Zeilen zurück.
 */
export async function migrateContractSignatures(options: { dryRun?: boolean } = {}) {
  const contracts = await prisma.contract.findMany({
    where: { signatures: { none: {} } },
    select: {
      id: true,
      title: true,
      token: true,
      status: true,
      signerDiscordId: true,
      signedAt: true,
      signedName: true,
      signedByUserId: true,
      signedIp: true,
      signedUserAgent: true,
      values: true,
      declinedAt: true,
      declineReason: true,
      agent: { select: { firstName: true, lastName: true, badgeNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  let written = 0

  for (const contract of contracts) {
    const agentName = contract.agent
      ? `${contract.agent.firstName} ${contract.agent.lastName}`.trim()
      : 'Unbekannt'

    if (options.dryRun) {
      console.log(
        `  [Probelauf] ${contract.id} „${contract.title}“ → ${agentName}` +
          ` (Status ${contract.status}${contract.signedAt ? ', unterschrieben' : ''})`,
      )
      continue
    }

    await prisma.contractSignature.create({
      data: {
        contractId: contract.id,
        // Aus Sicht des FIB unterschreibt hier der Agent, nicht die Behörde.
        side: 'EXTERNAL',
        partyName: agentName.slice(0, 200),
        partyRole: contract.agent?.badgeNumber
          ? `Dienstnummer ${contract.agent.badgeNumber}`.slice(0, 200)
          : null,
        sortOrder: 0,
        token: contract.token,
        signerDiscordId: contract.signerDiscordId,
        signedAt: contract.signedAt,
        signedName: contract.signedName,
        signedByUserId: contract.signedByUserId,
        signedIp: contract.signedIp,
        signedUserAgent: contract.signedUserAgent,
        values: contract.values ?? undefined,
        declinedAt: contract.declinedAt,
        declineReason: contract.declineReason,
      },
    })
    written += 1
  }

  return options.dryRun ? contracts.length : written
}
