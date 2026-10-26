import { invoke } from '@tauri-apps/api/core'

// Spiegel der Rust-Befehle in src-tauri/src/lib.rs.

export type Clipper = 'nvidia' | 'medal' | 'amd' | 'selfclip'
export type ClipQuality = '720p' | '1080p' | 'original'

export interface Settings {
  clipper: Clipper
  bodycamHotkey: string
  clipperHotkey: string
  clipDir: string
  lastInvestigationId: string | null
  clipQuality: ClipQuality
  killClip?: KillClipConfig
  selfClip?: SelfClipConfig
  quickNoteHotkey: string
  crashReports: boolean
}

export interface SelfClipConfig {
  bufferSeconds: number
  bitrateMbps: number
  fps: number
  audio: boolean
}

export interface SelfClipStatus {
  installed: boolean
  running: boolean
  encoder: string | null
  bufferedSeconds: number
  audioSource: string | null
  error: string | null
  downloadBytes: number
}

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface KillClipConfig {
  playerName: string
  useMarker: boolean
  killfeed: Region | null
  hitmarker: Region | null
  hitmarkerThreshold: number
  mergeSeconds: number
  preSeconds: number
  postSeconds: number
  replaySeconds: number
  deleteSource: boolean
}

export interface KillClipStatus {
  running: boolean
  phase: '' | 'idle' | 'watching' | 'saving' | 'rendering' | 'uploading'
  pendingKills: number
  target: { channel: { name: string } | null; limitBytes: number; reason: string | null } | null
  lastFeed: string
  error: string | null
}

export interface KillClipEvent {
  kind: 'kill' | 'death' | 'rendered' | 'uploaded' | 'error' | 'warning'
  message: string
  link: string | null
  path: string | null
  at: number
}

/** Einrichtungstaste: erst `saving`, dann der gespeicherte Replay oder ein Fehler. */
export interface KillClipReferenceClip {
  saving?: boolean
  path?: string
  duration?: number
  error?: string
}

/** Ergebnis der Einrichtung: was die App rund um den markierten Kill gefunden hat. */
export interface KillClipReference {
  path: string
  markerPath: string | null
  width: number
  height: number
  at: number
  killfeed: Region | null
  victim: string | null
  line: string | null
  hitmarker: Region | null
  markerScore: number
}

export interface SettingsView {
  settings: Settings
  defaultClipDir: string
  defaultClipperHotkey: string
}

export interface ClipInfo {
  path: string
  name: string
  sizeBytes: number
  durationSeconds: number | null
  savedAt: number
}

export interface Option {
  id: string
  label: string
}

export interface SessionContext {
  user: { displayName: string; avatarUrl: string | null }
  canUpload: boolean
  tools: { bodycam: boolean; dutyTimes: boolean; investigations: boolean; killClips?: boolean; agents?: boolean }
  permissions?: string[]
  ownAgent: Option | null
  agents: Option[]
  /** Discord-Profilbild je Agent-ID. */
  agentAvatars?: Record<string, string>
  investigations: (Option & { mine: boolean })[]
}

export interface UploadProgress {
  sentBytes: number
  totalBytes: number
  phase: 'upload' | 'finishing'
}

export interface ClipMeta {
  /** Ermittlungsakte – oder stattdessen `agentRecord`. */
  investigationId: string | null
  /** Neuer Eintrag in einer Agent-Akte, an dem der Clip als Beweis hängt. */
  agentRecord?: { agentId: string; kind: 'POSITIVE' | 'NEGATIVE'; title: string; content?: string }
  title: string
  description: string | null
  location: string | null
  recordedAt: string | null
  recordedByAgentId: string | null
  durationSeconds: number | null
  tags: string[]
  clientCompressed: boolean
}

export interface DutyAgent {
  id: string
  name: string
  badge: string
  avatarUrl: string | null
  rank: { name: string; color: string; order: number } | null
  onDuty: boolean
  dutySince: string | null
  weekMs: number
  sessionCount: number
  lastSeenAt: string | null
}

export interface DutyTimes {
  weekStart: string
  weekEnd: string
  agents: DutyAgent[]
}

// ── Tweaks (Spiegel von src-tauri/src/tweaks) ────────────────────────

export type TweakId =
  | 'mouse_acceleration'
  | 'keyboard_repeat'
  | 'keyboard_filterkeys'
  | 'keyboard_queue'
  | 'mouse_queue'
  | 'mmcss_games'
  | 'usb_polling'
  | 'fivem_raw_input'

export type TweakState =
  | 'inactive'
  | 'active'
  | 'partiallyActive'
  | 'applying'
  | 'restoring'
  | 'pendingRestart'
  | 'unsupported'
  | 'error'
  | 'diagnostic'

export interface TweakMeta {
  id: TweakId
  name: string
  description: string
  category: 'mouse' | 'keyboard' | 'system' | 'fivem'
  kind: 'toggle' | 'experimental' | 'diagnostic' | 'inGame'
  risk: 'none' | 'low' | 'medium'
  recommended: boolean
  needsAdmin: boolean
  needsRestart: boolean
  experimental: boolean
  inProfile: boolean
  ownRisk: boolean
  riskNotice: string | null
  /** Einstufung nach dem NERO-V-Regelwerk. */
  serverRule: { status: 'allowed' | 'ticketRequired' | 'forbidden'; paragraphs: string; reason: string }
  hasWindowsDefault: boolean
}

export interface SettingRow {
  label: string
  current: string
  target: string | null
  note: string | null
}

export interface TweakReport {
  meta: TweakMeta
  state: TweakState
  unsupported: string | null
  needsElevation: boolean
  settings: SettingRow[]
  explanation: string[]
  externalChange: boolean
  alreadyAtTarget: boolean
  deviatesFromDefault: boolean | null
  windowsDefaultSet: boolean
  managed: boolean
  error: string | null
}

export interface WasdStatus {
  state: TweakState
  activeCount: number
  profileCount: number
  managedCount: number
  pendingRestart: boolean
  isAdmin: boolean
  items: { id: TweakId; name: string; state: TweakState }[]
  features: string[]
  adminFeatures: string[]
  blockedByRules: boolean
  forbiddenDeviations: string[]
  error: string | null
}

export interface WasdDetails {
  status: WasdStatus
  tweaks: TweakReport[]
  backupPath: string
}

export interface PlannedChange {
  tweak: TweakId
  tweakName: string
  setting: string
  current: string
  target: string
  unchanged: boolean
}

export interface ApplyResult {
  written: number
  unchanged: number
}

export interface RestoreResult {
  restored: number
  conflicts: string[]
  failures: string[]
}

export interface InputDevice {
  kind: 'keyboard' | 'mouse'
  name: string
  manufacturer: string | null
  connection: 'usb' | 'bluetooth' | 'ps2' | 'virtual' | 'unknown'
  hardwareId: string | null
  vendorId: string | null
  productId: string | null
  driver: string | null
  note: string | null
}

export interface PollingResult {
  device: string
  vendorId: string | null
  productId: string | null
  events: number
  measuredHz: number | null
  nominalHz: number | null
  note: string | null
}

/** Verbrauch der App samt WebView2 und ffmpeg (src-tauri/src/resources.rs). */
export interface AppResources {
  cpuPercent: number
  memoryBytes: number
  threads: number
  parts: { name: string; processes: number; cpuPercent: number; memoryBytes: number; threads: number }[]
}

/** Rust meldet einen ungültigen oder fehlenden Token mit genau diesem Text. */
export const UNAUTHORIZED = 'UNAUTHORIZED'

export const backend = {
  getSettings: () => invoke<SettingsView>('get_settings'),
  saveSettings: (settings: Settings) => invoke<SettingsView>('save_settings', { settings }),
  rememberInvestigation: (id: string) => invoke<void>('remember_investigation', { id }),
  isSignedIn: () => invoke<boolean>('is_signed_in'),
  login: () => invoke<void>('login'),
  logout: () => invoke<void>('logout'),
  sessionContext: () => invoke<SessionContext>('session_context'),
  inspectClip: (path: string) => invoke<ClipInfo>('inspect_clip', { path }),
  captureClip: () => invoke<void>('capture_clip'),
  uploadClip: (path: string, meta: ClipMeta) => invoke<{ id: string }>('upload_clip', { path, meta }),
  cancelUpload: () => invoke<void>('cancel_upload'),
  convertClip: (path: string, options: { start: number | null; end: number | null; duration: number; quality: ClipQuality }) =>
    invoke<ClipInfo>('convert_clip', { path, ...options }),
  discardTrim: (path: string) => invoke<void>('discard_trim', { path }),
  dutyTimes: () => invoke<DutyTimes>('duty_times'),
  openDashboard: (path?: string) => invoke<void>('open_dashboard', { path: path ?? null }),
  selfClipStatus: () => invoke<SelfClipStatus>('selfclip_status'),
  selfClipInstall: () => invoke<SelfClipStatus>('selfclip_install'),
  selfClipSaveConfig: (config: SelfClipConfig) => invoke<SettingsView>('selfclip_save_config', { config }),
  selfClipRestart: () => invoke<void>('selfclip_restart'),
  tweaksStatus: () => invoke<WasdStatus>('get_wasd_tweak_status'),
  tweaksDetails: () => invoke<WasdDetails>('get_wasd_tweak_details'),
  tweaksPreview: () => invoke<PlannedChange[]>('preview_wasd_changes'),
  tweaksApplyProfile: () => invoke<ApplyResult>('apply_wasd_tweak'),
  tweaksRestoreProfile: (force = false) => invoke<RestoreResult>('restore_wasd_tweak', { force }),
  tweakApply: (id: TweakId, confirmed = false) => invoke<ApplyResult>('apply_tweak', { id, confirmed }),
  tweakRestore: (id: TweakId, force = false) => invoke<RestoreResult>('restore_tweak', { id, force }),
  tweakResetDefault: (id: TweakId) => invoke<ApplyResult>('reset_tweak_to_default', { id }),
  tweaksRestoreAll: (force = false) => invoke<RestoreResult>('restore_all_tweaks', { force }),
  inputDevices: () => invoke<InputDevice[]>('get_input_devices'),
  measurePolling: (seconds = 3) => invoke<PollingResult[]>('measure_polling_rate', { seconds }),
  appResources: () => invoke<AppResources>('app_resources'),
  noteAction: (action: string) => invoke<void>('note_action', { action }),
  reportError: (message: string, stack: string | null) => invoke<void>('report_error', { message, stack }),
  prepareRestart: () => invoke<void>('prepare_restart'),
  quickNoteOpen: () => invoke<void>('quick_note_open'),
  killClipStatus: () => invoke<KillClipStatus>('killclip_status'),
  killClipStart: () => invoke<KillClipStatus>('killclip_start'),
  killClipStop: () => invoke<void>('killclip_stop'),
  killClipSaveConfig: (config: KillClipConfig) => invoke<SettingsView>('killclip_save_config', { config }),
  killClipCalibration: (active: boolean) => invoke<string>('killclip_calibration', { active }),
  killClipAnalyze: (path: string, at: number) => invoke<KillClipReference>('killclip_analyze', { path, at }),
  killClipReveal: (path?: string) => invoke<void>('killclip_reveal', { path: path ?? null }),
  killClipOpenLink: (url: string) => invoke<void>('killclip_open_link', { url }),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  killClipTestFeed: (region: Region) => invoke<{ lines: string[]; kills: string[]; deaths: string[] }>('killclip_test_feed', { region }),
  killClipTestMarker: () => invoke<number>('killclip_test_marker'),
  killClipSavedReference: () =>
    invoke<{ path: string; markerPath: string | null; width: number; height: number; hitmarker: Region } | null>('killclip_saved_reference'),
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
