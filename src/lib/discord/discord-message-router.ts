/**
 * Verteilt neue Discord-Nachrichten aus dem Gateway: Lager-Channel → Lagerlogs,
 * Akten-Beitrag im Ermittlungs-Forum → Chronologie der Akte. Alles andere wird
 * ignoriert, ohne die Datenbank zu fragen, wo es sich vermeiden lässt.
 */
export async function routeDiscordMessage(data: unknown, botUserId: string) {
  const message = data as { id?: string; channel_id?: string; guild_id?: string; author?: { id?: string } }
  if (!message?.id || !message.channel_id || !message.guild_id) return

  const { isStorageLogChannel, ingestStorageMessage } = await import('@/lib/storage-logs/storage-logs-server')
  if (await isStorageLogChannel(message.channel_id)) {
    await ingestStorageMessage(data as Parameters<typeof ingestStorageMessage>[0])
    return
  }

  // Eigene Nachrichten des Bots sind die Spiegelung aus dem Dashboard.
  if (!message.author?.id || message.author.id === botUserId) return
  const { importForumThreadMessage } = await import('@/lib/investigations/investigation-forum-inbound')
  await importForumThreadMessage(data as Parameters<typeof importForumThreadMessage>[0])
}
