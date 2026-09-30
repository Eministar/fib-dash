/**
 * Erkennt über den Discord-Status, ob ein Agent gerade auf dem RP-Server
 * spielt, und entscheidet, wann er ans Einstempeln erinnert wird.
 * Bewusst ohne DB/Discord-Abhängigkeiten, damit die Regeln testbar bleiben.
 */

export type PresenceActivity = {
  name?: string | null
  type?: number
  details?: string | null
  state?: string | null
}

/** Treffer in Name, Details oder Status der Aktivität (ohne Groß-/Kleinschreibung). */
const TRACKED_GAME_PATTERNS = ['fivem', 'gta v with medal', 'nero-v roleplay']

/** Nur „Spielt …“ zählt – Musik, Streams oder der eigene Custom Status nicht. */
const PLAYING = 0

export function trackedGameName(activities: PresenceActivity[] | null | undefined): string | null {
  for (const activity of activities ?? []) {
    if (activity.type !== undefined && activity.type !== PLAYING) continue
    const text = [activity.name, activity.details, activity.state].filter(Boolean).join(' ').toLowerCase()
    if (TRACKED_GAME_PATTERNS.some((pattern) => text.includes(pattern))) return activity.name ?? 'FiveM'
  }
  return null
}

export class GameReminderTracker {
  private readonly playing = new Set<string>()
  private readonly lastReminder = new Map<string, number>()

  constructor(private readonly cooldownMs: number) {}

  /** Status beim Verbindungsaufbau übernehmen, ohne zu erinnern. */
  seed(userId: string, isPlaying: boolean) {
    if (isPlaying) this.playing.add(userId)
    else this.playing.delete(userId)
  }

  /** `true`, wenn der User das Spiel gerade gestartet hat und erinnert werden soll. */
  update(userId: string, isPlaying: boolean, now = Date.now()) {
    const wasPlaying = this.playing.has(userId)
    this.seed(userId, isPlaying)
    if (!isPlaying || wasPlaying) return false
    const last = this.lastReminder.get(userId)
    if (last !== undefined && now - last < this.cooldownMs) return false
    this.lastReminder.set(userId, now)
    return true
  }
}
