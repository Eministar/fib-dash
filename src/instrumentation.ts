export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { ensureClipCompressionWorker } = await import('./lib/clip-compression')
    ensureClipCompressionWorker()
    const { ensurePhotoCatalogSync } = await import('./lib/investigation-photos')
    ensurePhotoCatalogSync()
  }
}
