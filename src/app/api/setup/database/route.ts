import { NextRequest, NextResponse } from 'next/server'

import { getSetupStatus, testSetupDatabase } from '@/lib/setup'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const status = await getSetupStatus()
  if (!status.setupRequired) {
    return NextResponse.json({ success: false, error: 'Die Einrichtung ist bereits abgeschlossen.' }, { status: 409 })
  }

  try {
    const body = await request.json() as { databaseUrl?: unknown }
    if (typeof body.databaseUrl !== 'string') throw new Error('Bitte gib eine Datenbank-URL ein.')
    const data = await testSetupDatabase(body.databaseUrl)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Die Datenbankverbindung ist fehlgeschlagen.',
    }, { status: 400 })
  }
}
