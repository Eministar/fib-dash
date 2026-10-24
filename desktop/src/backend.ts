import { invoke } from '@tauri-apps/api/core'

// Spiegel der Rust-Befehle in src-tauri/src/lib.rs.

export type Clipper = 'nvidia' | 'medal'

export interface Settings {
  clipper: Clipper
  bodycamHotkey: string
  clipperHotkey: string
  clipDir: string
  lastInvestigationId: string | null
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
  ownAgent: Option | null
  agents: Option[]
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
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
