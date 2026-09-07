import { NextResponse } from 'next/server'

import { getSetupStatus } from '@/lib/setup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const data = await getSetupStatus()
  return NextResponse.json({ success: true, data }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}
