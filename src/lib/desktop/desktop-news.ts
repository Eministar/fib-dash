import {
  discordFetch,
  getCachedDiscordGuildMembers,
  getDiscordConfig,
  getDiscordGuildChannels,
  getDiscordGuildRoles,
  refreshDiscordGuildMembers,
  type DiscordApiUser,
} from '@/lib/discord/discord-integration'

/**
 * Ankündigungen für die Seite „Neuigkeiten“ der Desktop-App – aus dem dafür
 * eingestellten Channel, sonst aus dem Ankündigungs-Channel. Der Inhalt bleibt Discord-Markdown; die App
 * rendert ihn selbst und bekommt dafür Namen für Erwähnungen mitgeliefert.
 */

const MESSAGE_LIMIT = 30
// Alle offenen Apps fragen beim Öffnen der Seite – Discord nur einmal pro Minute.
const CACHE_MS = 60_000

type DiscordAttachment = {
  id: string
  filename: string
  url: string
  content_type?: string
  width?: number | null
  height?: number | null
  size: number
}

type DiscordEmbed = {
  type?: string
  title?: string
  description?: string
  url?: string
  color?: number
  timestamp?: string
  author?: { name: string; url?: string; icon_url?: string }
  footer?: { text: string; icon_url?: string }
  image?: { url: string; width?: number; height?: number }
  thumbnail?: { url: string; width?: number; height?: number }
  fields?: { name: string; value: string; inline?: boolean }[]
}

type DiscordMessageContent = {
  content: string
  attachments: DiscordAttachment[]
  embeds: DiscordEmbed[]
}

type DiscordMessage = DiscordMessageContent & {
  id: string
  type: number
  channel_id: string
  timestamp: string
  edited_timestamp: string | null
  author: DiscordApiUser & { bot?: boolean }
  mentions?: DiscordApiUser[]
  mention_roles?: string[]
  /** Weitergeleitete Nachrichten tragen ihren Inhalt hier statt in `content`. */
  message_snapshots?: { message: DiscordMessageContent }[]
}

export type NewsAttachment = {
  name: string
  url: string
  contentType: string | null
  width: number | null
  height: number | null
}

export type NewsEmbed = {
  title: string | null
  description: string | null
  url: string | null
  color: string | null
  author: { name: string; iconUrl: string | null } | null
  footer: string | null
  image: string | null
  thumbnail: string | null
  fields: { name: string; value: string; inline: boolean }[]
}

export type NewsAnnouncement = {
  id: string
  url: string
  createdAt: string
  editedAt: string | null
  author: { name: string; avatarUrl: string; color: string | null; bot: boolean }
  content: string
  attachments: NewsAttachment[]
  embeds: NewsEmbed[]
}

export type NewsMentions = {
  users: Record<string, string>
  roles: Record<string, { name: string; color: string | null }>
  channels: Record<string, string>
}

export type DesktopAnnouncements = {
  configured: boolean
  announcements: NewsAnnouncement[]
  mentions: NewsMentions
}

// Nur echte Beiträge (normal, Antwort) – keine Systemmeldungen wie „hat angepinnt“.
const CONTENT_TYPES = new Set([0, 19])

function hexColor(color: number | null | undefined) {
  return color ? `#${color.toString(16).padStart(6, '0')}` : null
}

function userAvatarUrl(user: DiscordApiUser, guildId: string, memberAvatar?: string | null) {
  if (memberAvatar) return `https://cdn.discordapp.com/guilds/${guildId}/users/${user.id}/avatars/${memberAvatar}.png?size=64`
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
  const index = Number((BigInt(user.id) >> BigInt(22)) % BigInt(6))
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

function toEmbed(embed: DiscordEmbed): NewsEmbed | null {
  // Link-Vorschauen von Bildern/GIFs zeigt die App als Bild, nicht als Karte.
  if ((embed.type === 'image' || embed.type === 'gifv') && embed.thumbnail) {
    return { title: null, description: null, url: null, color: null, author: null, footer: null, image: embed.thumbnail.url, thumbnail: null, fields: [] }
  }
  if (!embed.title && !embed.description && !embed.fields?.length && !embed.image && !embed.author) return null
  return {
    title: embed.title ?? null,
    description: embed.description ?? null,
    url: embed.url ?? null,
    color: hexColor(embed.color),
    author: embed.author ? { name: embed.author.name, iconUrl: embed.author.icon_url ?? null } : null,
    footer: embed.footer?.text ?? null,
    image: embed.image?.url ?? null,
    thumbnail: embed.thumbnail?.url ?? null,
    fields: (embed.fields ?? []).map((field) => ({ name: field.name, value: field.value, inline: !!field.inline })),
  }
}

async function loadAnnouncements(): Promise<DesktopAnnouncements> {
  const config = await getDiscordConfig()
  const channelId = config.desktopNewsChannelId || config.announcementsChannelId
  const guildId = config.guildId
  const empty: NewsMentions = { users: {}, roles: {}, channels: {} }
  if (!channelId || !guildId) return { configured: false, announcements: [], mentions: empty }

  const [messages, roles, channels] = await Promise.all([
    discordFetch<DiscordMessage[]>(`/channels/${channelId}/messages?limit=${MESSAGE_LIMIT}`),
    getDiscordGuildRoles(guildId).catch(() => []),
    getDiscordGuildChannels(guildId).catch(() => []),
  ])

  // Spitznamen und Server-Profilbilder nur aus dem Cache – nie auf die volle Mitgliederliste warten.
  const members = new Map((getCachedDiscordGuildMembers(guildId) ?? []).flatMap((m) => (m.user ? [[m.user.id, m] as const] : [])))
  if (!members.size) refreshDiscordGuildMembers(guildId)
  const roleById = new Map(roles.map((role) => [role.id, role]))

  const displayName = (user: DiscordApiUser) => members.get(user.id)?.nick || user.global_name || user.username
  const topRoleColor = (userId: string) => {
    const colored = (members.get(userId)?.roles ?? [])
      .map((id) => roleById.get(id))
      .filter((role) => role && role.color)
      .sort((a, b) => b!.position - a!.position)
    return hexColor(colored[0]?.color)
  }

  const users: Record<string, string> = {}
  const announcements = messages
    .filter((message) => CONTENT_TYPES.has(message.type))
    .map((message): NewsAnnouncement => {
      for (const user of message.mentions ?? []) users[user.id] = displayName(user)
      const body = !message.content && !message.attachments.length && !message.embeds.length && message.message_snapshots?.[0]
        ? message.message_snapshots[0].message
        : message
      return {
        id: message.id,
        url: `https://discord.com/channels/${guildId}/${channelId}/${message.id}`,
        createdAt: message.timestamp,
        editedAt: message.edited_timestamp,
        author: {
          name: displayName(message.author),
          avatarUrl: userAvatarUrl(message.author, guildId, members.get(message.author.id)?.avatar),
          color: topRoleColor(message.author.id),
          bot: !!message.author.bot,
        },
        content: body.content ?? '',
        attachments: (body.attachments ?? []).map((attachment) => ({
          name: attachment.filename,
          url: attachment.url,
          contentType: attachment.content_type ?? null,
          width: attachment.width ?? null,
          height: attachment.height ?? null,
        })),
        embeds: (body.embeds ?? []).map(toEmbed).filter((embed): embed is NewsEmbed => !!embed),
      }
    })
    .filter((item) => item.content || item.attachments.length || item.embeds.length)

  // Erwähnte Personen, die Discord nicht mitliefert (z. B. in Embeds), über den Cache auflösen.
  const texts = announcements.flatMap((item) => [
    item.content,
    ...item.embeds.flatMap((embed) => [embed.description ?? '', ...embed.fields.map((field) => field.value)]),
  ])
  for (const [, id] of texts.join('\n').matchAll(/<@!?(\d+)>/g)) {
    const user = members.get(id)?.user
    if (!users[id] && user) users[id] = displayName(user)
  }

  return {
    configured: true,
    announcements,
    mentions: {
      users,
      roles: Object.fromEntries(roles.map((role) => [role.id, { name: role.name, color: hexColor(role.color) }])),
      channels: Object.fromEntries(channels.map((channel) => [channel.id, channel.name ?? 'Kanal'])),
    },
  }
}

let cache: { at: number; data: DesktopAnnouncements } | null = null
let pending: Promise<DesktopAnnouncements> | null = null

export async function getDesktopAnnouncements(): Promise<DesktopAnnouncements> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  pending ??= loadAnnouncements()
    .then((data) => {
      cache = { at: Date.now(), data }
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}
