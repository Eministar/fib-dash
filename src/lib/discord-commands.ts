import { getDiscordConfig } from './discord-integration'

const STRING = 3
const BOOLEAN = 5
const USER = 6
const API_BASE = 'https://discord.com/api/v10'

type DiscordCommand = {
  id: string
  name: string
}

export const DISCORD_COMMANDS = [
  {
    name: 'fib-einstellung',
    description: 'Stellt einen Agent ein und sendet die HR-Meldung.',
    options: [
      { type: USER, name: 'discord', description: 'Discord-User', required: true },
      { type: STRING, name: 'vorname', description: 'Vorname', required: true },
      { type: STRING, name: 'nachname', description: 'Nachname', required: true },
      { type: STRING, name: 'rang', description: 'Rang', required: true, autocomplete: true },
      { type: STRING, name: 'dienstnummer', description: 'Dienstnummer, leer für automatisch', required: false },
      { type: STRING, name: 'units', description: 'Units, mit Komma getrennt', required: false },
    ],
  },
  {
    name: 'fib-beförderung',
    description: 'Ändert den Rang eines Agents und meldet die Beförderung oder Degradierung.',
    options: [
      { type: USER, name: 'discord', description: 'Discord-User des Agents', required: true },
      { type: STRING, name: 'rang', description: 'Neuer Rang', required: true, autocomplete: true },
      { type: STRING, name: 'dienstnummer', description: 'Neue Dienstnummer, leer für automatisch', required: false },
      { type: STRING, name: 'notiz', description: 'Interne Notiz', required: false },
    ],
  },
  {
    name: 'fib-ausbildung',
    description: 'Setzt eine Ausbildung auf abgeschlossen oder offen.',
    options: [
      { type: USER, name: 'discord', description: 'Discord-User des Agents', required: true },
      { type: STRING, name: 'ausbildung', description: 'Ausbildung', required: true, autocomplete: true },
      { type: BOOLEAN, name: 'abgeschlossen', description: 'Abgeschlossen?', required: true },
    ],
  },
  {
    name: 'fib-unit',
    description: 'Setzt oder ändert die Unit-Zuordnung eines Agents.',
    options: [
      { type: USER, name: 'discord', description: 'Discord-User des Agents', required: true },
      {
        type: STRING,
        name: 'aktion',
        description: 'Wie soll die Unit geändert werden?',
        required: true,
        choices: [
          { name: 'setzen', value: 'set' },
          { name: 'hinzufügen', value: 'add' },
          { name: 'entfernen', value: 'remove' },
        ],
      },
      { type: STRING, name: 'unit', description: 'Unit', required: true, autocomplete: true },
    ],
  },
  {
    name: 'fib-kündigung',
    description: 'Kündigt einen Agent, meldet die Kündigung und entfernt konfigurierte Rollen.',
    options: [
      { type: USER, name: 'discord', description: 'Discord-User des Agents', required: true },
      { type: STRING, name: 'grund', description: 'Grund', required: true },
    ],
  },
  {
    name: 'fib-abmeldung',
    description: 'Meldet dich oder einen Agent für einen Zeitraum ab.',
    options: [
      { type: STRING, name: 'bis', description: 'Ende, z.B. 12.05.2026 20:00', required: true },
      { type: STRING, name: 'grund', description: 'Grund der Abmeldung', required: true },
      { type: STRING, name: 'von', description: 'Start, leer = jetzt, z.B. 10.05.2026 18:00', required: false },
      { type: USER, name: 'discord', description: 'Optional: anderer Agent', required: false },
    ],
  },
]

function botToken() {
  return process.env.DISCORD_BOT_TOKEN?.trim() || process.env.FIB_DISCORD_BOT_TOKEN?.trim() || ''
}

async function discordCommandRequest<T>(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json',
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Discord Command-Registrierung fehlgeschlagen: ${res.status} ${text}`)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export async function registerDiscordCommands() {
  const config = await getDiscordConfig()
  const token = botToken()
  if (!token) throw new Error('Discord Bot-Token fehlt')
  if (!config.guildId) throw new Error('Discord Guild-ID fehlt')
  if (!config.applicationId) throw new Error('Discord Application-ID fehlt')

  const basePath = `/applications/${config.applicationId}/guilds/${config.guildId}/commands`
  const existingCommands = await discordCommandRequest<DiscordCommand[]>(basePath, token)

  const updatedCommands = await Promise.all(
    DISCORD_COMMANDS.map((command) => {
      const existing = existingCommands.find((item) => item.name === command.name)
      if (existing) {
        return discordCommandRequest<DiscordCommand>(`${basePath}/${existing.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify(command),
        })
      }

      return discordCommandRequest<DiscordCommand>(basePath, token, {
        method: 'POST',
        body: JSON.stringify(command),
      })
    }),
  )

  return {
    updated: updatedCommands.length,
    kept: existingCommands.filter((command) => !DISCORD_COMMANDS.some((item) => item.name === command.name)).length,
    commands: updatedCommands,
  }
}
