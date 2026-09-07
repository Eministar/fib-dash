import { NextResponse } from 'next/server'

import { getCommitHistory } from '@/lib/release-history'

export const dynamic = 'force-dynamic'

export async function GET() {
  const data = await getCommitHistory()
  return NextResponse.json({ success: true, data })
}
