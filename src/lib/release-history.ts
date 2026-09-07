import commitLegendSnapshot from '../../docs/commit-legend.json'

import { APP_VERSION_LABEL, releaseBuildId, releaseBuildShort } from '@/lib/release'
import { GITHUB_REPO_URL } from '@/lib/site'

export interface CommitLegendEntry {
  buildId: string
  commit: string
  shortCommit: string
  subject: string
  author: string
  date: string
  url: string
}

export interface CommitLegendDocument {
  repository: string
  generatedAt: string
  entries: CommitLegendEntry[]
}

export interface CommitHistoryResponse extends CommitLegendDocument {
  appVersion: string
  currentBuildId: string
  currentBuildShort: string
  source: 'github' | 'snapshot'
}

interface GitHubApiCommit {
  sha?: string
  html_url?: string
  author?: { login?: string } | null
  commit?: {
    message?: string
    author?: { name?: string; date?: string } | null
    committer?: { date?: string } | null
  } | null
}

const GITHUB_API_BASE = 'https://api.github.com'

function repositorySlug() {
  const match = GITHUB_REPO_URL.match(/github\.com\/([^/]+\/[^/#]+)/i)
  return match?.[1] ?? ''
}

export function buildIdForCommit(commit: string) {
  const normalized = commit.trim()
  return `build-${normalized.slice(0, 10) || 'unknown'}`
}

function firstLine(message: unknown) {
  if (typeof message !== 'string') return 'Ohne Commit-Nachricht'
  return message.split(/\r?\n/, 1)[0]?.trim() || 'Ohne Commit-Nachricht'
}

function toLegendEntry(commit: GitHubApiCommit): CommitLegendEntry | null {
  const sha = typeof commit?.sha === 'string' ? commit.sha.trim() : ''
  if (!sha) return null

  const author =
    (typeof commit?.author?.login === 'string' && commit.author.login) ||
    (typeof commit?.commit?.author?.name === 'string' && commit.commit.author.name) ||
    'Unbekannt'
  const date =
    (typeof commit?.commit?.author?.date === 'string' && commit.commit.author.date) ||
    (typeof commit?.commit?.committer?.date === 'string' && commit.commit.committer.date) ||
    new Date(0).toISOString()

  return {
    buildId: buildIdForCommit(sha),
    commit: sha,
    shortCommit: sha.slice(0, 10),
    subject: firstLine(commit?.commit?.message),
    author,
    date,
    url: typeof commit?.html_url === 'string' ? commit.html_url : `${GITHUB_REPO_URL}/commit/${sha}`,
  }
}

async function fetchGitHubLegend(): Promise<CommitLegendEntry[]> {
  const entries: CommitLegendEntry[] = []
  const seen = new Set<string>()
  const slug = repositorySlug()
  if (!slug) throw new Error('Kein GitHub-Repository konfiguriert')

  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${slug}/commits?per_page=100&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'fib-hr-release-history',
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        next: { revalidate: 60 },
      },
    )

    if (!response.ok) {
      throw new Error(`GitHub Commit API antwortete mit ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('Ungültige Antwort der GitHub Commit API')

    for (const commit of payload as GitHubApiCommit[]) {
      const entry = toLegendEntry(commit)
      if (entry && !seen.has(entry.commit)) {
        seen.add(entry.commit)
        entries.push(entry)
      }
    }

    if (payload.length < 100) break
  }

  return entries
}

function readSnapshot(): CommitLegendDocument | null {
  const parsed: unknown = commitLegendSnapshot
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as CommitLegendDocument).entries)) {
    return null
  }
  return parsed as CommitLegendDocument
}

function withCurrentBuild(entries: CommitLegendEntry[]) {
  const currentId = releaseBuildId()
  if (currentId === 'unknown') return entries

  const currentBuildId = buildIdForCommit(currentId)
  if (entries.some((entry) => entry.buildId === currentBuildId || entry.commit === currentId)) {
    return entries
  }

  return [
    {
      buildId: currentBuildId,
      commit: currentId,
      shortCommit: currentId.slice(0, 10),
      subject: 'Aktueller Build – noch nicht in GitHub synchronisiert',
      author: 'Lokaler Build',
      date: new Date().toISOString(),
      url: `${GITHUB_REPO_URL}/commit/${currentId}`,
    },
    ...entries,
  ]
}

export async function getCommitHistory(): Promise<CommitHistoryResponse> {
  const repository = repositorySlug()
  let entries: CommitLegendEntry[]
  let source: CommitHistoryResponse['source'] = 'github'
  let generatedAt = new Date().toISOString()

  try {
    entries = await fetchGitHubLegend()
  } catch {
    const snapshot = readSnapshot()
    entries = snapshot?.entries ?? []
    generatedAt = snapshot?.generatedAt ?? generatedAt
    source = 'snapshot'
  }

  return {
    repository: repository || 'FIB Dashboard',
    generatedAt,
    entries: withCurrentBuild(entries),
    appVersion: APP_VERSION_LABEL,
    currentBuildId: releaseBuildId(),
    currentBuildShort: releaseBuildShort(),
    source,
  }
}
