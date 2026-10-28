/** A parsed duration is not proof that WebView2 can decode the video track. */
export function videoErrorText(error: Pick<MediaError, 'code' | 'message'> | null) {
  const reason = {
    1: 'Das Laden wurde abgebrochen.',
    2: 'Die Videodatei konnte nicht vollständig gelesen werden.',
    3: 'Windows konnte das Videobild nicht decodieren.',
    4: 'Die Datei ist nicht erreichbar oder ihr Videoformat wird hier nicht unterstützt.',
  }[error?.code ?? 0] ?? 'Es wurde kein abspielbares Videobild geladen.'
  return `${reason}${error?.code ? ` (Medienfehler ${error.code})` : ''}`
}

/** Load and seek the original file, without converting or modifying it. */
export function loadVideoFrame(video: HTMLVideoElement, src: string, options: {
  startAt: number
  duration?: number
  signal: AbortSignal
  timeoutMs?: number
}): Promise<number> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new DOMException('Laden abgebrochen', 'AbortError'))
    video.pause()
    video.removeAttribute('src')
    video.load()
    let duration = 0
    let metadataLoaded = false
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadedmetadata', metadata)
      video.removeEventListener('loadeddata', ready)
      video.removeEventListener('seeked', ready)
      video.removeEventListener('error', failed)
      options.signal.removeEventListener('abort', aborted)
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const aborted = () => fail(new DOMException('Laden abgebrochen', 'AbortError'))
    const failed = () => {
      // Ignore an old resource's queued error after changing the source.
      if (video.error) fail(new Error(videoErrorText(video.error)))
    }
    const ready = () => {
      if (!metadataLoaded || video.seeking || video.readyState < 2) return
      if (!video.videoWidth || !video.videoHeight) {
        fail(new Error('Die Aufnahme enthält kein decodierbares Videobild. Eine Tonspur allein reicht für die Einrichtung nicht aus.'))
        return
      }
      cleanup()
      resolve(duration)
    }
    const metadata = () => {
      duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : options.duration ?? 0
      if (!Number.isFinite(duration) || duration <= 0) return fail(new Error('Die Länge der Aufnahme konnte nicht gelesen werden.'))
      if (!video.videoWidth || !video.videoHeight) {
        return fail(new Error('Windows hat nur Ton oder keine lesbare Videospur geladen. Das Videoformat kann auf diesem Rechner möglicherweise nicht decodiert werden.'))
      }
      metadataLoaded = true
      const at = options.startAt < 0 ? duration + options.startAt : options.startAt
      try {
        video.currentTime = Math.min(Math.max(0, at), Math.max(0, duration - 0.05))
      } catch {
        return fail(new Error('Die gewünschte Stelle der Aufnahme konnte nicht geladen werden.'))
      }
      ready()
    }
    const timer = setTimeout(() => fail(new Error('Innerhalb von 30 Sekunden wurde kein Videobild geladen. Bitte den Clip erneut öffnen und prüfen, ob die Originaldatei lokal verfügbar ist.')), options.timeoutMs ?? 30_000)
    video.addEventListener('loadedmetadata', metadata)
    video.addEventListener('loadeddata', ready)
    video.addEventListener('seeked', ready)
    video.addEventListener('error', failed)
    options.signal.addEventListener('abort', aborted, { once: true })
    try {
      video.src = src
      video.load()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
