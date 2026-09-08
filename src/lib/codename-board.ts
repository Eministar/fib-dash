/** Pure rendering: never truncate the roster, even with unusually long names. */
export function codenameBoardPages(rows: { name: string; currentAgent: { firstName: string; lastName: string; badgeNumber: string } | null }[], prefix: string) {
  const clean = (text: string) => text.replace(/[`\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim()
  const pages: string[][] = [[]]
  for (const row of rows) {
    if (!row.currentAgent) continue
    const agent = row.currentAgent
    const line = `${clean([prefix, row.name].filter(Boolean).join(' '))}  |  ${clean(agent.lastName)}, ${clean(agent.firstName)}  |  ${clean(agent.badgeNumber)}`
    let page = pages[pages.length - 1]
    if (page.length && (page.length >= 30 || page.join('\n').length + line.length + 1 > 3500)) {
      page = []
      pages.push(page)
    }
    page.push(line)
  }
  return pages.map(page => page.length ? '```\n' + page.join('\n') + '\n```' : 'Derzeit sind keine Decknamen vergeben.')
}

/** Persist each new/deleted ID immediately so retries resume after partial failure. */
export async function reconcileCodenameMessages<T>(input: {
  ids: string[]
  pages: T[]
  patch: (id: string, page: T) => Promise<void>
  post: (page: T) => Promise<string>
  remove: (id: string) => Promise<void>
  save: (ids: string[]) => Promise<void>
  isMissing: (cause: unknown) => boolean
}) {
  const ids = [...input.ids]
  for (let index = 0; index < input.pages.length; index++) {
    if (ids[index]) {
      try { await input.patch(ids[index], input.pages[index]); continue }
      catch (cause) { if (!input.isMissing(cause)) throw cause }
    }
    ids[index] = await input.post(input.pages[index])
    await input.save([...ids])
  }
  while (ids.length > input.pages.length) {
    try { await input.remove(ids[ids.length - 1]) }
    catch (cause) { if (!input.isMissing(cause)) throw cause }
    ids.pop()
    await input.save([...ids])
  }
  return ids
}
