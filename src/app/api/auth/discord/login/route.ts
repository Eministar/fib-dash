import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getDiscordConfig } from '@/lib/discord-integration'

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

function baseUrl(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  }
  const requestUrl = new URL(req.url)
  const host = firstForwardedValue(req.headers.get('x-forwarded-host')) || req.headers.get('host') || requestUrl.host
  const proto = firstForwardedValue(req.headers.get('x-forwarded-proto')) || requestUrl.protocol.replace(':', '') || 'https'
  return `${proto}://${host}`
}

const LOGIN_MODES = ['application', 'contract'] as const

/**
 * Nur app-interne Pfade zulassen — ein offener Redirect würde den Login-Flow
 * zum Weiterleiten auf fremde Seiten missbrauchbar machen.
 */
function safeRedirectPath(value: string | null) {
  if (!value) return ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  return value.slice(0, 300)
}

export async function GET(req: NextRequest) {
  const config = await getDiscordConfig()
  const clientId = config.applicationId
  const state = crypto.randomUUID()
  const remember = req.nextUrl.searchParams.get('remember') === '1'
  const modeParam = req.nextUrl.searchParams.get('mode')
  const mode = (LOGIN_MODES as readonly string[]).includes(modeParam ?? '')
    ? (modeParam as (typeof LOGIN_MODES)[number])
    : 'dashboard'
  const redirectPath = safeRedirectPath(req.nextUrl.searchParams.get('redirect'))
  const redirectUri = `${baseUrl(req)}/api/auth/discord/callback`

  if (!clientId) {
    const fallbackPath = redirectPath || (mode === 'application' ? '/bewerbung' : '/login')
    const url = new URL(fallbackPath, baseUrl(req))
    url.searchParams.set('error', 'Discord Application-ID ist nicht konfiguriert')
    return NextResponse.redirect(url)
  }

  const cookieStore = await cookies()
  cookieStore.set('discord-oauth-state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 5,
  })
  cookieStore.set('discord-oauth-remember', remember ? '1' : '0', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 5,
  })
  cookieStore.set('discord-oauth-mode', mode, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 5,
  })
  cookieStore.set('discord-oauth-redirect', redirectPath, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 5,
  })

  const authorizeUrl = new URL('https://discord.com/oauth2/authorize')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', 'identify')
  authorizeUrl.searchParams.set('state', state)

  return NextResponse.redirect(authorizeUrl)
}
