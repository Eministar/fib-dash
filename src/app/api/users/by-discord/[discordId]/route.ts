import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'
import { success, error, unauthorized, forbidden, notFound } from '@/lib/api-response'
import { resolveEffectivePermissions } from '@/lib/permissions'
import { storedDiscordAvatarUrl } from '@/lib/discord-auth'

interface Ctx { params: Promise<{ discordId: string }> }

const DISCORD_SNOWFLAKE = /^\d{17,22}$/

/**
 * Liefert User-Infos + effektive Permissions für eine Discord-ID.
 *
 * Use-Case: API-Clients fragen vorab ab, welche Rechte ein Discord-User
 * hat, bevor sie einen `X-Discord-Id` Header an einen Request hängen.
 *
 * Auth: jeder authentifizierte Aufrufer (Cookie oder Bearer-Token) — keine
 * zusätzliche Permission nötig. Es werden **keine sensiblen Felder** wie
 * E-Mail, Discord-Tokens o.ä. zurückgegeben.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireAuth()
    const { discordId } = await ctx.params

    if (!DISCORD_SNOWFLAKE.test(discordId)) {
      return error('Ungültige Discord-ID (muss 17–22 Ziffern haben)', 400)
    }

    const user = await prisma.user.findFirst({
      where: { discordId },
      select: {
        id: true,
        username: true,
        displayName: true,
        discordId: true,
        discordAvatar: true,
        discordDiscriminator: true,
        discordUsername: true,
        discordGlobalName: true,
        lastLoginAt: true,
        permissions: true,
        group: { select: { id: true, name: true, permissions: true } },
        groupMemberships: {
          select: { group: { select: { id: true, name: true, permissions: true } } },
        },
      },
    })

    if (!user) return notFound('Benutzer mit dieser Discord-ID')

    const groupsById = new Map(user.groupMemberships.map((m) => [m.group.id, m.group]))
    if (user.group && !groupsById.has(user.group.id)) groupsById.set(user.group.id, user.group)
    const groups = Array.from(groupsById.values())
    const permissions = resolveEffectivePermissions(
      user.permissions,
      groups.map((g) => g.permissions),
    )

    return success({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      discordId: user.discordId,
      discordUsername: user.discordUsername,
      discordGlobalName: user.discordGlobalName,
      avatarUrl: storedDiscordAvatarUrl(user),
      lastLoginAt: user.lastLoginAt,
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      permissions,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Serverfehler'
    if (msg === 'Unauthorized') return unauthorized()
    if (msg === 'Forbidden') return forbidden()
    return error(msg, 500)
  }
}
