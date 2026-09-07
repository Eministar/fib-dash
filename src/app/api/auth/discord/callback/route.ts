import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { signToken } from '@/lib/auth'
import {
  exchangeDiscordCode,
  fetchDiscordCurrentUser,
  syncDiscordApplicantProfile,
  syncDiscordContractSignerProfile,
  syncDiscordUserProfile,
} from '@/lib/discord-auth'

type LoginMode = 'dashboard' | 'application' | 'contract'

function isLoginMode(value: string | undefined): value is LoginMode {
  return value === 'application' || value === 'contract' || value === 'dashboard'
}

function safeRedirectPath(value: string | undefined) {
  if (!value) return ''
  if (!value.startsWith('/') || value.startsWith('//')) return ''
  return value.slice(0, 300)
}

function defaultPathForMode(mode: LoginMode) {
  if (mode === 'application') return '/bewerbung'
  if (mode === 'contract') return '/'
  return '/'
}

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

function loginError(req: NextRequest, message: string, mode: LoginMode, redirectPath: string) {
  const target = redirectPath || (mode === 'application' ? '/bewerbung' : '/login')
  const url = new URL(target, baseUrl(req))
  url.searchParams.set('error', message)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const expectedState = cookieStore.get('discord-oauth-state')?.value
  const remember = cookieStore.get('discord-oauth-remember')?.value === '1'
  const modeCookie = cookieStore.get('discord-oauth-mode')?.value
  const mode: LoginMode = isLoginMode(modeCookie) ? modeCookie : 'dashboard'
  const redirectPath = safeRedirectPath(cookieStore.get('discord-oauth-redirect')?.value)
  const state = req.nextUrl.searchParams.get('state')
  const code = req.nextUrl.searchParams.get('code')

  cookieStore.delete('discord-oauth-state')
  cookieStore.delete('discord-oauth-remember')
  cookieStore.delete('discord-oauth-mode')
  cookieStore.delete('discord-oauth-redirect')

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginError(req, 'Discord-Login konnte nicht verifiziert werden', mode, redirectPath)
  }

  try {
    const redirectUri = `${baseUrl(req)}/api/auth/discord/callback`
    const token = await exchangeDiscordCode(code, redirectUri)
    const discordUser = await fetchDiscordCurrentUser(token.access_token)
    const user = mode === 'application'
      ? await syncDiscordApplicantProfile(discordUser)
      : mode === 'contract'
        ? await syncDiscordContractSignerProfile(discordUser)
        : await syncDiscordUserProfile(discordUser)
    const jwt = signToken({ userId: user.id, username: user.username })
    const response = NextResponse.redirect(
      new URL(redirectPath || defaultPathForMode(mode), baseUrl(req)),
    )

    response.cookies.set('auth-token', jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}),
    })

    return response
  } catch (err) {
    return loginError(req, err instanceof Error ? err.message : 'Discord-Login fehlgeschlagen', mode, redirectPath)
  }
}
