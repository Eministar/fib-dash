import { NextRequest, NextResponse } from 'next/server'

import { completeSetup, getSetupStatus, type CompleteSetupInput } from '@/lib/setup'

export const runtime = 'nodejs'
export const maxDuration = 180

let setupInProgress = false

function protectedError(error: unknown, secrets: string[]) {
  let message = error instanceof Error ? error.message : 'Die Einrichtung konnte nicht abgeschlossen werden.'
  for (const secret of secrets.filter(Boolean)) message = message.replaceAll(secret, '[geschützt]')
  return message.replace(/(mysql|mariadb):\/\/[^\s]+/gi, '$1://[geschützt]')
}

export async function POST(request: NextRequest) {
  if (setupInProgress) {
    return NextResponse.json({ success: false, error: 'Die Einrichtung läuft bereits.' }, { status: 409 })
  }

  const status = await getSetupStatus()
  if (!status.setupRequired) {
    return NextResponse.json({ success: false, error: 'Die Einrichtung ist bereits abgeschlossen.' }, { status: 409 })
  }

  let body: Partial<CompleteSetupInput> = {}
  try {
    body = await request.json() as Partial<CompleteSetupInput>
    const requiredStrings: (keyof CompleteSetupInput)[] = [
      'databaseUrl',
      'botToken',
      'clientSecret',
      'applicationId',
      'guildId',
      'siteUrl',
    ]
    for (const key of requiredStrings) {
      if (typeof body[key] !== 'string' || !body[key]?.trim()) throw new Error(`Pflichtfeld fehlt: ${key}`)
    }
    if (!Array.isArray(body.adminRoleIds)) throw new Error('Wähle mindestens eine Administrator-Rolle aus.')

    setupInProgress = true
    const data = await completeSetup(body as CompleteSetupInput)
    return NextResponse.json({ success: true, data })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: protectedError(error, [
        typeof body.databaseUrl === 'string' ? body.databaseUrl : '',
        typeof body.botToken === 'string' ? body.botToken : '',
        typeof body.clientSecret === 'string' ? body.clientSecret : '',
      ]),
    }, { status: 400 })
  } finally {
    setupInProgress = false
  }
}
