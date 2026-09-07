export const RANK_CHANGE_VOTE_VALUES = ['HIGHER', 'CONFIRM', 'LOWER'] as const

export type RankChangeVoteValue = (typeof RANK_CHANGE_VOTE_VALUES)[number]

export interface RankChangeVoteSummary {
  higherVotes: number
  confirmVotes: number
  lowerVotes: number
  currentUserVote: RankChangeVoteValue | null
}

interface StoredRankChangeVote {
  userId: string
  value: string
}

export function summarizeRankChangeVotes(
  votes: StoredRankChangeVote[],
  currentUserId: string,
): RankChangeVoteSummary {
  let higherVotes = 0
  let confirmVotes = 0
  let lowerVotes = 0
  let currentUserVote: RankChangeVoteValue | null = null

  for (const vote of votes) {
    // Alte UP-/DOWN-Stimmen werden bewusst nicht als neue, gerichtete Stimmen umgedeutet.
    if (vote.value === 'HIGHER') higherVotes += 1
    if (vote.value === 'CONFIRM') confirmVotes += 1
    if (vote.value === 'LOWER') lowerVotes += 1
    if (vote.userId === currentUserId && isRankChangeVoteValue(vote.value)) {
      currentUserVote = vote.value
    }
  }

  return { higherVotes, confirmVotes, lowerVotes, currentUserVote }
}

export function isRankChangeVoteValue(value: unknown): value is RankChangeVoteValue {
  return typeof value === 'string' && RANK_CHANGE_VOTE_VALUES.some((candidate) => candidate === value)
}
