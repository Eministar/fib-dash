import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

interface GitHubCommit {
  sha?: string
  html_url?: string
  author?: { login?: string } | null
  commit?: {
    message?: string
    author?: { name?: string; date?: string } | null
    committer?: { date?: string } | null
  } | null
}

interface CommitLegendEntry {
  buildId: string
  commit: string
  shortCommit: string
  subject: string
  author: string
  date: string
  url: string
}

function repositorySlug() {
  const configured = process.env.GITHUB_REPOSITORY?.trim()
  if (configured) return configured

  const remote = process.env.GITHUB_REPO_URL?.trim() ?? ''
  const match = remote.match(/github\.com\/([^/]+\/[^/#]+)/i)
  if (!match) throw new Error('GITHUB_REPOSITORY oder GITHUB_REPO_URL konfigurieren')
  return match[1]
}

function firstLine(message: string | undefined) {
  return message?.split(/\r?\n/, 1)[0]?.trim() || 'Ohne Commit-Nachricht'
}

function toEntry(commit: GitHubCommit): CommitLegendEntry | null {
  const sha = commit.sha?.trim()
  if (!sha) return null

  const author = commit.author?.login || commit.commit?.author?.name || 'Unbekannt'
  const date = commit.commit?.author?.date || commit.commit?.committer?.date || new Date(0).toISOString()

  return {
    buildId: `build-${sha.slice(0, 10)}`,
    commit: sha,
    shortCommit: sha.slice(0, 10),
    subject: firstLine(commit.commit?.message),
    author,
    date,
    url: commit.html_url || `https://github.com/${repositorySlug()}/commit/${sha}`,
  }
}

async function fetchAllCommits() {
  const entries: CommitLegendEntry[] = []
  const seen = new Set<string>()
  const slug = repositorySlug()

  for (let page = 1; ; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${slug}/commits?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'fib-hr-release-history-sync',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    })

    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`GitHub Commit API ${response.status}: ${detail.slice(0, 180)}`)
    }

    const payload = (await response.json()) as unknown
    if (!Array.isArray(payload)) throw new Error('Ungültige Antwort der GitHub Commit API')

    for (const commit of payload as GitHubCommit[]) {
      const entry = toEntry(commit)
      if (entry && !seen.has(entry.commit)) {
        seen.add(entry.commit)
        entries.push(entry)
      }
    }

    if (payload.length < 100) break
  }

  return entries
}

async function main() {
  const entries = await fetchAllCommits()
  const output = {
    repository: repositorySlug(),
    generatedAt: new Date().toISOString(),
    entries,
  }
  const outputPath = path.join(process.cwd(), 'docs', 'commit-legend.json')
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Commit-Legende aktualisiert: ${entries.length} Einträge → ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
