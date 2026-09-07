type TableAlign = 'left' | 'center' | 'right' | null
type LinkReference = {
  href: string
  title?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function isSafeLinkHref(href: string) {
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(href)
}

function isSafeImageSrc(src: string) {
  return /^(https?:\/\/|\/(?!\/))/i.test(src)
}

function normalizeReferenceId(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseReferenceDefinition(value: string) {
  const reference = /^\[([^\]]+)]:\s+(\S+)(?:\s+(?:"([^"]+)"|'([^']+)'|\(([^)]+)\)))?\s*$/.exec(value.trim())
  if (!reference) return null

  const href = reference[2]
  if (!isSafeLinkHref(href) && !isSafeImageSrc(href)) return null

  return {
    id: normalizeReferenceId(reference[1]),
    href,
    title: reference[3] ?? reference[4] ?? reference[5],
  }
}

function renderInline(value: string, references: Map<string, LinkReference> = new Map()) {
  const codeSpans: string[] = []
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, code: string) => {
    const index = codeSpans.push(`<code>${code}</code>`) - 1
    return `\u0000CODE${index}\u0000`
  })

  html = html.replace(/&lt;br\s*\/?&gt;/gi, '<br />')
  html = html.replace(/&lt;(https?:\/\/[^>\s]+)&gt;/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
  html = html.replace(/&lt;([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})&gt;/gi, '<a href="mailto:$1">$1</a>')
  html = html.replace(/\[\[([^\]]+)]]/g, '<kbd>$1</kbd>')
  html = html.replace(
    /!\[([^\]]*)]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (match, alt: string, src: string, title?: string) => {
      if (!isSafeImageSrc(src)) return match
      const titleAttr = title ? ` title="${title}"` : ''
      return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async"${titleAttr} />`
    },
  )
  html = html.replace(/!\[([^\]]*)]\[([^\]]*)]/g, (match, alt: string, id: string) => {
    const reference = references.get(normalizeReferenceId(id || alt))
    if (!reference || !isSafeImageSrc(reference.href)) return match
    const titleAttr = reference.title ? ` title="${reference.title}"` : ''
    return `<img src="${reference.href}" alt="${alt}" loading="lazy" decoding="async"${titleAttr} />`
  })
  html = html.replace(/\*\*~([^~]+)~\*\*/g, '<span class="markdown-signature">$1</span>')
  html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>')
  html = html.replace(/\+\+([^+]+)\+\+/g, '<ins>$1</ins>')
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  html = html.replace(/(?<!\*)~([^~\s][^~]*[^~\s]|[^~\s])~/g, '<sub>$1</sub>')
  html = html.replace(/\^([^^\s][^^]*[^^\s]|[^^\s])\^/g, '<sup>$1</sup>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (!isSafeLinkHref(href)) return match
    const externalAttrs = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
    return `<a href="${href}"${externalAttrs}>${label}</a>`
  })
  html = html.replace(/\[([^\]]+)]\[([^\]]*)]/g, (match, label: string, id: string) => {
    const reference = references.get(normalizeReferenceId(id || label))
    if (!reference || !isSafeLinkHref(reference.href)) return match
    const externalAttrs = /^https?:\/\//i.test(reference.href) ? ' target="_blank" rel="noopener noreferrer"' : ''
    const titleAttr = reference.title ? ` title="${reference.title}"` : ''
    return `<a href="${reference.href}"${externalAttrs}${titleAttr}>${label}</a>`
  })

  return html.replace(/\u0000CODE(\d+)\u0000/g, (_, index: string) => codeSpans[Number(index)] ?? '')
}

function splitTableRow(row: string) {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function parseTableAlign(row: string): TableAlign[] | null {
  const cells = splitTableRow(row)
  if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null
  return cells.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
}

function tableAlignClass(align: TableAlign) {
  if (align === 'center') return ' class="text-center"'
  if (align === 'right') return ' class="text-right"'
  return ''
}

function parseHeadingText(value: string) {
  const customId = /\s+\{#([A-Za-z0-9_-]+)}\s*$/.exec(value)
  const textWithoutId = customId ? value.slice(0, customId.index).trim() : value.trim()
  const text = textWithoutId.replace(/\s+#+\s*$/, '').trim()

  return {
    id: customId?.[1] ?? slugify(text),
    text,
  }
}

function renderFootnotes(footnotes: Map<string, string>, references: Map<string, LinkReference>) {
  if (footnotes.size === 0) return ''

  return `<section class="markdown-footnotes"><h2 id="fußnoten">Fußnoten</h2><ol>${Array.from(footnotes)
    .map(([id, text]) => `<li id="fn-${id}">${renderInline(text, references)} <a href="#fnref-${id}" aria-label="Zurück zur Referenz">↩</a></li>`)
    .join('')}</ol></section>`
}

export function renderMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  const footnotes = new Map<string, string>()
  const references = new Map<string, LinkReference>()
  let index = 0

  for (const currentLine of lines) {
    const reference = parseReferenceDefinition(currentLine)
    if (reference) {
      references.set(reference.id, { href: reference.href, title: reference.title })
    }
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const reference = parseReferenceDefinition(trimmed)
    if (reference) {
      references.set(reference.id, { href: reference.href, title: reference.title })
      index += 1
      continue
    }

    const footnote = /^\[\^([^\]]+)]:\s+(.+)$/.exec(trimmed)
    if (footnote) {
      footnotes.set(footnote[1], footnote[2])
      index += 1
      continue
    }

    const codeBlock = /^(```|~~~)([A-Za-z0-9_-]+)?\s*$/.exec(trimmed)
    if (codeBlock) {
      const fence = codeBlock[1]
      const language = codeBlock[2]
      const code: string[] = []
      index += 1

      while (index < lines.length && lines[index].trim() !== fence) {
        code.push(lines[index])
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      const languageClass = language ? ` class="language-${language}"` : ''
      html.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    if (/^( {4}|\t)/.test(line)) {
      const code: string[] = []

      while (index < lines.length && (/^( {4}|\t)/.test(lines[index]) || !lines[index].trim())) {
        code.push(lines[index].replace(/^( {4}|\t)/, ''))
        index += 1
      }

      html.push(`<pre><code>${escapeHtml(code.join('\n').trimEnd())}</code></pre>`)
      continue
    }

    if (index + 1 < lines.length && /^={3,}$/.test(lines[index + 1].trim())) {
      const heading = parseHeadingText(trimmed)
      html.push(`<h1 id="${heading.id}">${renderInline(heading.text, references)}</h1>`)
      index += 2
      continue
    }

    if (index + 1 < lines.length && /^-{3,}$/.test(lines[index + 1].trim())) {
      const heading = parseHeadingText(trimmed)
      html.push(`<h2 id="${heading.id}">${renderInline(heading.text, references)}</h2>`)
      index += 2
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length
      const parsedHeading = parseHeadingText(heading[2])
      html.push(`<h${level} id="${parsedHeading.id}">${renderInline(parsedHeading.text, references)}</h${level}>`)
      index += 1
      continue
    }

    if (/^([-*_])(?:\s*\1){2,}$/.test(trimmed)) {
      html.push('<hr />')
      index += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('> ')) {
        quote.push(lines[index].trim().slice(2))
        index += 1
      }
      const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)]$/i.exec(quote[0] ?? '')
      if (alert) {
        const type = alert[1].toLowerCase()
        html.push(`<blockquote class="markdown-alert markdown-alert-${type}">${quote.slice(1).map((item) => renderInline(item, references)).join('<br />')}</blockquote>`)
      } else {
        html.push(`<blockquote>${quote.map((item) => renderInline(item, references)).join('<br />')}</blockquote>`)
      }
      continue
    }

    if (index + 1 < lines.length && /^:\s+/.test(lines[index + 1].trim())) {
      const items: { term: string; definitions: string[] }[] = []

      while (index < lines.length) {
        const term = lines[index].trim()
        if (!term || index + 1 >= lines.length || !/^:\s+/.test(lines[index + 1].trim())) break

        index += 1
        const definitions: string[] = []
        while (index < lines.length && /^:\s+/.test(lines[index].trim())) {
          definitions.push(lines[index].trim().replace(/^:\s+/, ''))
          index += 1
        }
        items.push({ term, definitions })
      }

      html.push(`<dl>${items.map((item) => `<dt>${renderInline(item.term, references)}</dt>${item.definitions
        .map((definition) => `<dd>${renderInline(definition, references)}</dd>`)
        .join('')}`).join('')}</dl>`)
      continue
    }

    const tableAlign = index + 1 < lines.length ? parseTableAlign(lines[index + 1]) : null
    if (trimmed.includes('|') && tableAlign) {
      const headers = splitTableRow(trimmed)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].trim().includes('|')) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      html.push(
        `<div class="markdown-table-wrap"><table><thead><tr>${headers
          .map((header, cellIndex) => `<th${tableAlignClass(tableAlign[cellIndex])}>${renderInline(header, references)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row
            .map((cell, cellIndex) => `<td${tableAlignClass(tableAlign[cellIndex])}>${renderInline(cell, references)}</td>`)
            .join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      )
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: { text: string; checked: boolean | null }[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        const item = lines[index].trim().replace(/^[-*]\s+/, '')
        const task = /^\[( |x|X)]\s+(.+)$/.exec(item)
        items.push(task ? { text: task[2], checked: task[1].toLowerCase() === 'x' } : { text: item, checked: null })
        index += 1
      }
      const taskList = items.some((item) => item.checked !== null)
      html.push(`<ul${taskList ? ' class="markdown-task-list"' : ''}>${items.map((item) => (
        item.checked === null
          ? `<li>${renderInline(item.text, references)}</li>`
          : `<li><input type="checkbox" disabled${item.checked ? ' checked' : ''} />${renderInline(item.text, references)}</li>`
      )).join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      html.push(`<ol>${items.map((item) => `<li>${renderInline(item, references)}</li>`).join('')}</ol>`)
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index].trim()
      const nextTableAlign = index + 1 < lines.length ? parseTableAlign(lines[index + 1]) : null
      if (
        !current ||
        /^(#{1,6})\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current) ||
        current.startsWith('> ') ||
        /^(```|~~~)([A-Za-z0-9_-]+)?\s*$/.test(current) ||
        /^( {4}|\t)/.test(lines[index]) ||
        parseReferenceDefinition(current) ||
        /^\[\^([^\]]+)]:\s+/.test(current) ||
        /^([-*_])(?:\s*\1){2,}$/.test(current) ||
        (index + 1 < lines.length && /^={3,}$/.test(lines[index + 1].trim())) ||
        (index + 1 < lines.length && /^-{3,}$/.test(lines[index + 1].trim())) ||
        (index + 1 < lines.length && /^:\s+/.test(lines[index + 1].trim())) ||
        (current.includes('|') && nextTableAlign)
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    html.push(`<p>${paragraph.map((item) => renderInline(item, references)).join('<br />')}</p>`)
  }

  const withFootnoteReferences = html.join('\n').replace(/\[\^([^\]]+)]/g, (_, id: string) => (
    footnotes.has(id) ? `<sup id="fnref-${id}"><a href="#fn-${id}">${id}</a></sup>` : `[^${id}]`
  ))

  return [withFootnoteReferences, renderFootnotes(footnotes, references)].filter(Boolean).join('\n')
}
