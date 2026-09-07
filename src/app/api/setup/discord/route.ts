import { NextRequest, NextResponse } from 'next/server'

import { getSetupStatus, inspectDiscordBot } from '@/lib/setup'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const status = await getSetupStatus()
  if (!status.setupRequired) {
    return NextResponse.json({ success: false, error: 'Die Einrichtung ist bereits abgeschlossen.' }, { status: 409 })
  }

  try {
    const body = await request.json() as { botToken?: unknown; guildId?: unknown }
    if (typeof body.botToken !== 'string') throw new Error('Bitte gib ein Discord Bot-Token ein.')
    const guildId = typeof body.guildId === 'string' ? body.guildId : undefined
    const data = await inspectDiscordBot(body.botToken, guildId)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Discord konnte nicht geladen werden.',
    }, { status: 400 })
  }
}
