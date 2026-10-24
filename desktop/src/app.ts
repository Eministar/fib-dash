import { open } from '@tauri-apps/plugin-dialog'
import { backend, UNAUTHORIZED, type Clipper, type ClipQuality, type Settings, type SettingsView } from './backend'
import { $, errorText, initials, selectValue, showMessage, type ButtonElement, type DropdownElement } from './dom'
import { displayHotkey } from './format'
import { hotkeyInput } from './hotkey-input'
import { renderIcons } from './icons'
import { bodycamQueueLength, initBodycam } from './pages/bodycam'
import { hideDuty, initDuty, showDuty } from './pages/duty'
import { initKillClips, showKillClips } from './pages/killclips'
import { initHome } from './pages/home'
import { initInvestigations, showInvestigations } from './pages/investigations'
import { navigation, notifyStateChange, state, type Route } from './store'

type ValueElement = HTMLElement & { value: string }
type DialogElement = HTMLElement & { show(): void; hide(): void }

let route: Route = 'home'

// ── Ansichten ────────────────────────────────────────────────────────

function showView(view: 'login' | 'app') {
  $('view-login').hidden = view !== 'login'
  $('view-app').hidden = view !== 'app'
}

function go(next: Route) {
  const tool = document.querySelector<HTMLElement>(`.nav-item[data-route="${next}"]`)
  if (!tool || tool.hidden) next = 'home'
  if (route === 'duty' && next !== 'duty') hideDuty()
  route = next
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item[data-route]')) {
    if (item.dataset.route === next) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  for (const page of document.querySelectorAll<HTMLElement>('.page')) page.hidden = page.dataset.page !== next
  $('content').scrollTop = 0
  if (next === 'duty') showDuty()
  if (next === 'investigations') showInvestigations()
  if (next === 'killclips') showKillClips()
}

async function enterApp() {
  try {
    state.context = await backend.sessionContext()
  } catch (error) {
    if (errorText(error) === UNAUTHORIZED) return showLogin()
    showView('app')
    showMessage('capture-error', `Dashboard nicht erreichbar: ${errorText(error)}`)
    return
  }
  // Ältere Server liefern noch keine Werkzeugliste.
  state.context.tools ??= { bodycam: state.context.canUpload, dutyTimes: false, investigations: false }
  const { user, tools } = state.context
  $('account-name').textContent = user.displayName
  $('settings-account').textContent = user.displayName
  const avatar = $('account-avatar')
  if (user.avatarUrl) {
    avatar.textContent = ''
    avatar.style.backgroundImage = `url("${user.avatarUrl}")`
  } else {
    avatar.textContent = initials(user.displayName)
  }
  // Werkzeuge ohne Berechtigung gar nicht erst anbieten.
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item[data-tool]')) {
    item.hidden = !tools[item.dataset.tool as keyof typeof tools]
  }
  notifyStateChange()
  showView('app')
  go(bodycamQueueLength() ? 'bodycam' : route)
}

function showLogin() {
  state.context = null
  hideDuty()
  showView('login')
}

async function login() {
  const button = $('login-button') as ButtonElement
  button.disabled = true
  $('login-waiting').hidden = false
  showMessage('login-error', null)
  try {
    await backend.login()
    await enterApp()
  } catch (error) {
    showMessage('login-error', errorText(error))
  } finally {
    button.disabled = false
    $('login-waiting').hidden = true
  }
}

// ── Einstellungen ────────────────────────────────────────────────────

const bodycamHotkey = hotkeyInput($<ValueElement>('s-bodycam-hotkey'), {
  onChange: (hotkey) => updateSettings({ bodycamHotkey: hotkey }),
})
const clipperHotkey = hotkeyInput($<ValueElement>('s-clipper-hotkey'), {
  optional: true,
  placeholder: () => `Standard: ${displayHotkey(state.settings?.defaultClipperHotkey ?? '')}`,
  onChange: (hotkey) => updateSettings({ clipperHotkey: hotkey }),
})

function renderSettings(view: SettingsView) {
  state.settings = view
  const { settings } = view
  selectValue($<DropdownElement>('s-clipper'), settings.clipper)
  selectValue($<DropdownElement>('s-quality'), settings.clipQuality)
  bodycamHotkey.set(settings.bodycamHotkey)
  clipperHotkey.set(settings.clipperHotkey)
  $('s-clip-dir-label').textContent = settings.clipDir || `${view.defaultClipDir} (Standard)`
  $('s-clip-dir-label').title = settings.clipDir || view.defaultClipDir
  $('s-clip-dir-reset').hidden = !settings.clipDir
  notifyStateChange()
}

async function updateSettings(patch: Partial<Settings>) {
  if (!state.settings) return
  try {
    renderSettings(await backend.saveSettings({ ...state.settings.settings, ...patch }))
    showMessage('settings-error', null)
  } catch (error) {
    showMessage('settings-error', errorText(error))
    renderSettings(state.settings)
  }
}

function bindSettings() {
  const dialog = $<DialogElement>('settings-dialog')
  $('nav-settings').addEventListener('click', () => dialog.show())
  $('s-clipper').addEventListener('change', () => {
    const clipper = $<DropdownElement>('s-clipper').value as Clipper | null
    // Ordner und Taste gehören zum jeweiligen Programm – beim Wechsel auf dessen Standard.
    if (clipper && clipper !== state.settings?.settings.clipper) void updateSettings({ clipper, clipDir: '', clipperHotkey: '' })
  })
  $('s-quality').addEventListener('change', () => {
    const quality = $<DropdownElement>('s-quality').value as ClipQuality | null
    if (quality && quality !== state.settings?.settings.clipQuality) void updateSettings({ clipQuality: quality })
  })
  $('s-clip-dir-browse').addEventListener('click', async () => {
    const current = state.settings
    const dir = await open({ directory: true, defaultPath: current?.settings.clipDir || current?.defaultClipDir })
    if (typeof dir === 'string') void updateSettings({ clipDir: dir })
  })
  $('s-clip-dir-reset').addEventListener('click', () => updateSettings({ clipDir: '' }))
  $('logout-button').addEventListener('click', async () => {
    dialog.hide()
    await backend.logout()
    showLogin()
  })
}

// ── Start ────────────────────────────────────────────────────────────

export async function startApp() {
  renderIcons()
  navigation.go = go
  navigation.signOut = showLogin

  $('login-button').addEventListener('click', login)
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item[data-route]')) {
    item.addEventListener('click', () => go(item.dataset.route as Route))
  }
  bindSettings()
  initHome()
  initDuty()
  initInvestigations()
  initKillClips()
  await initBodycam()

  renderSettings(await backend.getSettings())
  if (await backend.isSignedIn()) await enterApp()
  else showLogin()
}
