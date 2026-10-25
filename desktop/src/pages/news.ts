import { getVersion } from '@tauri-apps/api/app'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { api } from '../api'
import { backend, UNAUTHORIZED } from '../backend'
import { $, errorText, escapeHtml, initials, showMessage, type ButtonElement } from '../dom'
import { formatAgo, formatDateTime } from '../format'
import { icon } from '../icons'
import { plainText, renderMarkdown, renderReleaseNotes, roleColored, type Mentions } from '../markdown'
import { navigation } from '../store'
import { autoRefresh } from '../ui/auto-refresh'

// Ankündigungen aus dem Discord-Ankündigungs-Channel und die Änderungen der
// letzten App-Versionen. Ungelesenes zählt die Navigation mit.

interface Attachment { name: string; url: string; contentType: string | null; width: number | null; height: number | null }

interface Embed {
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

interface Announcement {
  id: string
  url: string
  createdAt: string
  editedAt: string | null
  author: { name: string; avatarUrl: string; color: string | null; gradient?: string[] | null; bot: boolean }
  content: string
  attachments: Attachment[]
  embeds: Embed[]
}

interface Release { version: string; pubDate: string; notes?: string }

interface Server { name: string; iconUrl: string | null; channel: string | null }

interface News {
  configured: boolean
  server?: Server | null
  error: string | null
  announcements: Announcement[]
  mentions: Mentions
  releases: Release[]
}

type Tab = 'announcements' | 'releases'

// Im Hintergrund nachsehen, ob es Neues gibt (Zähler in der Navigation, Benachrichtigung).
// Der Server fragt Discord für alle Apps zusammen höchstens einmal pro Minute.
const POLL_MS = 60 * 1000
const SEEN_KEY = 'fib-desktop.news-seen'
/** Neuester Beitrag, zu dem schon eine Windows-Benachrichtigung kam. */
const NOTIFIED_KEY = 'fib-desktop.news-notified'

let data: News | null = null
let tab: Tab = 'announcements'
let installed = ''
let loading = false
let visible = false
/** Beim Öffnen der Seite noch ungelesen – behalten ihren Punkt bis zum nächsten Besuch. */
let unreadIds = new Set<string>()
const expanded = new Set<string>()
const collapsed = new Set<string>()

function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

const seenId = () => stored(SEEN_KEY)

function markSeen() {
  const newest = data?.announcements[0]?.id
  if (!newest) return
  try {
    localStorage.setItem(SEEN_KEY, newest)
  } catch {
    // Ohne Speicher zählt die App beim nächsten Start einfach erneut.
  }
  updateBadge()
}

// Discord-IDs steigen mit der Zeit – größer heißt neuer.
const newerThan = (id: string, seen: string) => !seen || BigInt(id) > BigInt(seen)

function unread() {
  const seen = seenId()
  // Beim allerersten Start nicht alle alten Beiträge als neu zählen.
  if (!seen) return []
  return data?.announcements.filter((a) => newerThan(a.id, seen)) ?? []
}

// ── Benachrichtigung ─────────────────────────────────────────────────

/** Liest man die Seite gerade, braucht es keine Benachrichtigung. */
const reading = () => visible && document.visibilityState === 'visible' && document.hasFocus()

function excerpt(post: Announcement) {
  const text = plainText(post.content, data!.mentions) || post.embeds.map((e) => e.title || plainText(e.description ?? '', data!.mentions)).find(Boolean)
  if (text) return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text
  return post.attachments.length ? 'Hat ein Bild geteilt.' : 'Neue Ankündigung'
}

async function notifyNew() {
  const seen = seenId()
  if (!seen || !data) return
  const notified = stored(NOTIFIED_KEY)
  const since = notified && newerThan(notified, seen) ? notified : seen
  const posts = data.announcements.filter((a) => newerThan(a.id, since))
  if (!posts.length) return
  try {
    localStorage.setItem(NOTIFIED_KEY, posts[0].id)
  } catch {
    // Ohne Speicher kann dieselbe Ankündigung erneut gemeldet werden.
  }
  if (reading()) return
  try {
    if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return
    const where = data.server?.name ?? 'Discord'
    sendNotification({
      title: posts.length === 1 ? `${posts[0].author.name} · ${where}` : `${posts.length} neue Ankündigungen · ${where}`,
      body: excerpt(posts[0]),
    })
  } catch (error) {
    console.warn('[News] Benachrichtigung fehlgeschlagen', error)
  }
}

function updateBadge() {
  const count = unread().length
  const badge = $('nav-news-badge')
  badge.textContent = count > 9 ? '9+' : String(count)
  badge.hidden = count === 0
  badge.title = count === 1 ? '1 neue Ankündigung' : `${count} neue Ankündigungen`
}

// ── Darstellung ──────────────────────────────────────────────────────

function isExpanded(post: Announcement, index: number) {
  if (expanded.has(post.id)) return true
  if (collapsed.has(post.id)) return false
  return index === 0 || unreadIds.has(post.id)
}

function attachmentHtml(attachment: Attachment) {
  if (attachment.contentType?.startsWith('image/')) {
    const ratio = attachment.width && attachment.height ? ` style="aspect-ratio:${attachment.width}/${attachment.height}"` : ''
    return `<button class="news-image" data-full="${escapeHtml(attachment.url)}" aria-label="Bild vergrößern"><img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name)}" loading="lazy" referrerpolicy="no-referrer"${ratio}></button>`
  }
  const kind = attachment.contentType?.startsWith('video/') ? 'Video ansehen' : 'Datei öffnen'
  return `<a class="news-file card" href="${escapeHtml(attachment.url)}">${icon('document')}<span class="truncate">${escapeHtml(attachment.name)}</span><span class="type-caption muted">${kind}</span></a>`
}

function embedHtml(embed: Embed, mentions: Mentions) {
  const style = embed.color ? ` style="--embed:${escapeHtml(embed.color)}"` : ''
  const title = embed.title
    ? `<div class="news-embed-title">${embed.url ? `<a href="${escapeHtml(embed.url)}">${escapeHtml(embed.title)}</a>` : escapeHtml(embed.title)}</div>`
    : ''
  // Reine Bild-Vorschau eines Links (z. B. GIF) ohne Rahmen.
  if (!title && !embed.description && !embed.author && !embed.fields.length && embed.image) {
    return `<div class="news-images">${attachmentHtml({ name: '', url: embed.image, contentType: 'image/', width: null, height: null })}</div>`
  }
  return `
    <div class="news-embed"${style}>
      <div class="news-embed-main">
        ${embed.author ? `<div class="news-embed-author">${embed.author.iconUrl ? `<img src="${escapeHtml(embed.author.iconUrl)}" alt="" referrerpolicy="no-referrer">` : ''}${escapeHtml(embed.author.name)}</div>` : ''}
        ${title}
        ${embed.description ? `<div class="markdown">${renderMarkdown(embed.description, mentions)}</div>` : ''}
        ${embed.fields.length ? `<div class="news-embed-fields">${embed.fields.map((f) => `<div class="${f.inline ? 'inline' : ''}"><div class="type-body-strong">${renderMarkdown(f.name, mentions)}</div><div class="markdown">${renderMarkdown(f.value, mentions)}</div></div>`).join('')}</div>` : ''}
        ${embed.image ? `<div class="news-images">${attachmentHtml({ name: '', url: embed.image, contentType: 'image/', width: null, height: null })}</div>` : ''}
        ${embed.footer ? `<div class="type-caption muted">${escapeHtml(embed.footer)}</div>` : ''}
      </div>
      ${embed.thumbnail ? `<img class="news-embed-thumb" src="${escapeHtml(embed.thumbnail)}" alt="" referrerpolicy="no-referrer">` : ''}
    </div>`
}

function postHtml(post: Announcement, index: number, mentions: Mentions) {
  const open = isExpanded(post, index)
  const date = new Date(post.createdAt)
  const images = post.attachments.filter((a) => a.contentType?.startsWith('image/'))
  const files = post.attachments.filter((a) => !a.contentType?.startsWith('image/'))
  const extras = images.length + files.length + post.embeds.length
  return `
    <article class="card news-post${open ? ' open' : ''}" data-id="${escapeHtml(post.id)}">
      <button class="news-head" aria-expanded="${open}">
        <span class="avatar">${escapeHtml(initials(post.author.name))}<img class="avatar-img" src="${escapeHtml(post.author.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
        <span class="news-meta">
          <span class="type-body-strong truncate">${roleColored(escapeHtml(post.author.name), post.author.color, post.author.gradient)}${post.author.bot ? '<span class="badge">BOT</span>' : ''}</span>
          <span class="type-caption muted" title="${escapeHtml(formatDateTime(date))}">${escapeHtml(formatAgo(date))} · ${escapeHtml(formatDateTime(date))}${post.editedAt ? ' · bearbeitet' : ''}</span>
        </span>
        ${unreadIds.has(post.id) ? '<span class="news-new">Neu</span>' : ''}
        ${!open && extras ? `<span class="type-caption muted news-extras">${icon(images.length ? 'image' : 'document')}${extras}</span>` : ''}
        <span class="news-chevron">${icon('chevronDown')}</span>
      </button>
      <div class="news-body">
        ${post.content ? `<div class="markdown">${renderMarkdown(post.content, mentions)}</div>` : ''}
        ${open && images.length ? `<div class="news-images count-${Math.min(images.length, 4)}">${images.map(attachmentHtml).join('')}</div>` : ''}
        ${open && files.length ? `<div class="news-files">${files.map(attachmentHtml).join('')}</div>` : ''}
        ${open ? post.embeds.map((embed) => embedHtml(embed, mentions)).join('') : ''}
        ${open ? `<div class="news-actions"><a href="${escapeHtml(post.url)}" class="type-caption">${icon('open')}In Discord öffnen</a></div>` : ''}
      </div>
    </article>`
}

function releaseHtml(release: Release) {
  const current = release.version === installed
  return `
    <article class="news-release${current ? ' current' : ''}">
      <span class="news-release-dot"></span>
      <div class="news-release-body">
        <div class="news-release-head">
          <span class="type-body-strong">Version ${escapeHtml(release.version)}</span>
          ${current ? '<span class="badge installed">Installiert</span>' : ''}
          <span class="type-caption muted">${escapeHtml(formatDateTime(new Date(release.pubDate)))}</span>
        </div>
        <div class="markdown">${renderReleaseNotes(release.notes)}</div>
      </div>
    </article>`
}

function renderServer() {
  const server = data?.server
  const serverIcon = $('news-server-icon')
  serverIcon.hidden = !server?.iconUrl
  // Nur bei neuem Bild ersetzen, sonst flackert es bei jedem Neuladen.
  if (server?.iconUrl && serverIcon.dataset.url !== server.iconUrl) {
    serverIcon.dataset.url = server.iconUrl
    serverIcon.innerHTML = `<img src="${escapeHtml(server.iconUrl)}" alt="${escapeHtml(server.name)}" referrerpolicy="no-referrer">`
  }
  $('news-subtitle').innerHTML = server
    ? `Ankündigungen aus <strong>${escapeHtml(server.name)}</strong>${server.channel ? ` <span class="news-channel">#${escapeHtml(server.channel)}</span>` : ''} und was sich in der App geändert hat.`
    : 'Ankündigungen aus dem Discord und was sich in der App geändert hat.'
}

function render() {
  $('news-tabs').setAttribute('activeid', `news-tab-${tab}`)
  if (!data) return
  renderServer()
  $('news-tab-announcements-count').textContent = data.announcements.length ? String(data.announcements.length) : ''
  $('news-announcements').hidden = tab !== 'announcements'
  $('news-releases').hidden = tab !== 'releases'
  $('news-toggle-all').hidden = tab !== 'announcements' || data.announcements.length < 2

  const list = $('news-announcements')
  if (!data.configured) {
    list.innerHTML = '<div class="card empty">Im Dashboard ist noch kein Channel für Neuigkeiten eingestellt.</div>'
  } else if (!data.announcements.length) {
    list.innerHTML = `<div class="card empty">${data.error ? escapeHtml(data.error) : 'Noch keine Ankündigungen.'}</div>`
  } else {
    list.innerHTML = data.announcements.map((post, i) => postHtml(post, i, data!.mentions)).join('')
  }
  const allOpen = data.announcements.every((post, i) => isExpanded(post, i))
  $('news-toggle-all-label').textContent = allOpen ? 'Alle einklappen' : 'Alle ausklappen'

  $('news-releases').innerHTML = data.releases.length
    ? `<div class="card news-timeline">${data.releases.map(releaseHtml).join('')}</div>`
    : '<div class="card empty">Noch keine Versionen veröffentlicht.</div>'
}

function toggle(id: string) {
  if (!data) return
  const index = data.announcements.findIndex((post) => post.id === id)
  if (index < 0) return
  const open = isExpanded(data.announcements[index], index)
  expanded.delete(id)
  collapsed.delete(id)
  ;(open ? collapsed : expanded).add(id)
  render()
}

function toggleAll() {
  if (!data) return
  const allOpen = data.announcements.every((post, i) => isExpanded(post, i))
  expanded.clear()
  collapsed.clear()
  for (const post of data.announcements) (allOpen ? collapsed : expanded).add(post.id)
  render()
}

// ── Bild groß ansehen ────────────────────────────────────────────────

function openLightbox(url: string) {
  const box = $('news-lightbox')
  $<HTMLImageElement>('news-lightbox-img').src = url
  $('news-lightbox-open').dataset.url = url
  box.hidden = false
  box.focus()
}

function closeLightbox() {
  $('news-lightbox').hidden = true
  $<HTMLImageElement>('news-lightbox-img').removeAttribute('src')
}

// ── Laden ────────────────────────────────────────────────────────────

/** `fresh`: am Server am Minuten-Cache vorbei direkt bei Discord nachsehen. */
async function load(fresh = false) {
  if (loading) return
  loading = true
  const button = $<ButtonElement>('news-refresh')
  if (fresh) {
    button.disabled = true
    button.classList.add('spinning')
  }
  try {
    data = await api.get<News>(`/api/desktop/news${fresh ? '?refresh=1' : ''}`)
    showMessage('news-error', null)
    $('news-updated').textContent = `Stand ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    // Erster Start: bisherige Beiträge gelten als gelesen, ab jetzt wird gezählt.
    if (!seenId()) markSeen()
    await notifyNew()
    if (visible) {
      for (const post of unread()) unreadIds.add(post.id)
      render()
      markSeen()
    } else {
      updateBadge()
    }
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return navigation.signOut()
    if (visible) showMessage('news-error', `Neuigkeiten konnten nicht geladen werden: ${errorText(error)}`)
  } finally {
    loading = false
    button.disabled = false
    button.classList.remove('spinning')
  }
}

export function initNews() {
  void getVersion().then((version) => (installed = version))
  $('news-refresh').addEventListener('click', () => void load(true))
  $('news-toggle-all').addEventListener('click', toggleAll)
  for (const [id, value] of [['news-tab-announcements', 'announcements'], ['news-tab-releases', 'releases']] as const) {
    $(id).addEventListener('click', () => {
      tab = value
      render()
    })
  }

  $('news-announcements').addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const image = target.closest<HTMLElement>('.news-image')
    if (image) return openLightbox(image.dataset.full!)
    const spoiler = target.closest('.md-spoiler')
    if (spoiler) return spoiler.classList.add('revealed')
    // Links öffnet der globale Link-Handler im Browser.
    if (target.closest('a')) return
    const head = target.closest<HTMLElement>('.news-head')
    const post = target.closest<HTMLElement>('.news-post')
    // Eingeklappt öffnet ein Klick irgendwo auf den Beitrag, ausgeklappt nur der Kopf.
    if (post && (head || !post.classList.contains('open'))) toggle(post.dataset.id!)
  })

  const box = $('news-lightbox')
  box.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('#news-lightbox-open')) {
      void backend.openExternal($('news-lightbox-open').dataset.url!)
      return
    }
    closeLightbox()
  })
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLightbox()
  })

  autoRefresh('news', () => load())

  window.setInterval(() => {
    // Nur angemeldet nachsehen (sonst gibt es keine Navigation).
    if (!$('view-app').hidden) void load()
  }, POLL_MS)
}

/** Nach der Anmeldung: Zähler für Ungelesenes füllen. */
export function refreshNewsBadge() {
  void load()
}

export function showNews() {
  visible = true
  unreadIds = new Set(unread().map((post) => post.id))
  render()
  if (data) markSeen()
  void load()
}

export function hideNews() {
  visible = false
  closeLightbox()
}

/** Seite direkt auf dem Reiter „App-Updates“ öffnen (z. B. aus „Was ist neu“). */
export function showReleaseNotes() {
  tab = 'releases'
  navigation.go('news')
}
