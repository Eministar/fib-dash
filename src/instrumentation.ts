export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { ensureLeadershipGroupSync } = await import('./lib/leadership-groups-server')
    ensureLeadershipGroupSync()
    const { ensureClipCompressionWorker } = await import('./lib/clip-compression')
    ensureClipCompressionWorker()
    const { ensurePhotoCatalogSync } = await import('./lib/investigation-photos')
    ensurePhotoCatalogSync()
    const { ensureHirePingCleanup } = await import('./lib/hire-ping')
    ensureHirePingCleanup()
    const { ensureUploadCleanupWorker } = await import('./lib/upload-sessions')
    ensureUploadCleanupWorker()
  }
}
