import { APP_VERSION_LABEL, releaseBuildId } from '@/lib/core/release'

export const dynamic = 'force-dynamic'

/**
 * Ausgelieferter Stand, öffentlich und ohne Datenbank. Der Desktop-Workflow
 * wartet hierüber, bis der Server einen Commit tatsächlich deployt hat.
 */
export function GET() {
  return Response.json(
    { buildId: releaseBuildId(), version: APP_VERSION_LABEL },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
