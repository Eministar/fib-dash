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
  kind: 'kill' | 'rendered' | 'uploaded' | 'error'
  message: string
  link: string | null
  path: string | null
  at: number
}

export interface KillClipScreenshot {
  path?: string
  width?: number
  height?: number
  at?: number
  error?: string
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
  tools: { bodycam: boolean; dutyTimes: boolean; investigations: boolean; killClips?: boolean }
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
  investigationId: string
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
  killClipStatus: () => invoke<KillClipStatus>('killclip_status'),
  killClipStart: () => invoke<KillClipStatus>('killclip_start'),
  killClipStop: () => invoke<void>('killclip_stop'),
  killClipSaveConfig: (config: KillClipConfig) => invoke<SettingsView>('killclip_save_config', { config }),
  killClipCalibration: (active: boolean) => invoke<string>('killclip_calibration', { active }),
  killClipScreenshot: () => invoke<void>('killclip_screenshot'),
  killClipSetHitmarker: (region: Region) => invoke<void>('killclip_set_hitmarker', { region }),
  killClipReveal: (path?: string) => invoke<void>('killclip_reveal', { path: path ?? null }),
  killClipOpenLink: (url: string) => invoke<void>('killclip_open_link', { url }),
  killClipTestFeed: (region: Region, name: string) => invoke<{ lines: string[]; kills: string[] }>('killclip_test_feed', { region, name }),
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
