// Kurze Rückmeldungen wie die InfoBar in WinUI – unten rechts, verschwinden von selbst.

let host: HTMLElement | null = null

export function toast(text: string, intent: 'success' | 'error' | 'info' | 'warning' = 'success') {
  if (!host) {
    host = document.createElement('div')
    host.className = 'toast-host'
    document.body.append(host)
  }
  const bar = document.createElement('fluent-message-bar')
  bar.setAttribute('intent', intent)
  bar.textContent = text
  host.append(bar)
  setTimeout(() => bar.remove(), intent === 'error' ? 7000 : 3500)
}
