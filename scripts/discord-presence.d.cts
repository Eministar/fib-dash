type Environment = Record<string, string | undefined>
type BotPresence = { status: string; since: null; afk: boolean; activities: { name: string; type: number }[] }
export function presenceInterval(env?: Environment): number
type PresenceStats = { activeAgents: number; completedTrainings: number }
export function botPresence(env?: Environment, now?: number, stats?: PresenceStats | null): BotPresence
export function loadPresenceStats(client: {
  agent: { count(args: { where: { status: 'ACTIVE' } }): PromiseLike<number> }
  agentTraining: { count(args: { where: { completed: true } }): PromiseLike<number> }
}): Promise<PresenceStats>
export function createPresenceRotation(send: (payload: { op: number; d: BotPresence }) => void, env?: Environment, loadStats?: () => Promise<PresenceStats>): { current: () => BotPresence; start: () => void; stop: () => void }
