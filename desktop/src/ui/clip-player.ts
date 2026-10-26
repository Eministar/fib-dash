import { convertFileSrc } from '@tauri-apps/api/core'
import { api } from '../api'
import { $, errorText } from '../dom'

/** Was der Player von einem Clip braucht – aus Ermittlungsakte oder Agent-Akte. */
export interface PlayableClip {
  id: string
  title: string
  mimeType: string
}

/**
 * Spielt einen Bodycam-Clip im gemeinsamen Dialog ab. Das Fenster hat keinen Token,
 * darum lädt Rust die Datei in den Cache und das Video spielt sie lokal.
 */
export async function playClip(clip: PlayableClip) {
  const dialog = $('player-dialog') as HTMLElement & { show(): void; hide(): void }
  const video = $('player-dialog-video') as HTMLVideoElement
  $('player-dialog-title').textContent = clip.title
  $('player-dialog-status').textContent = 'Clip wird geladen …'
  $('player-dialog-status').hidden = false
  video.hidden = true
  dialog.show()
  try {
    const ext = clip.mimeType.includes('webm') ? 'webm' : 'mp4'
    const local = await api.download(`/api/investigations/clips/${clip.id}/stream`, `${clip.id}.${ext}`)
    video.src = convertFileSrc(local)
    video.hidden = false
    $('player-dialog-status').hidden = true
    void video.play()
  } catch (error) {
    $('player-dialog-status').textContent = `Clip konnte nicht geladen werden: ${errorText(error)}`
  }
}
