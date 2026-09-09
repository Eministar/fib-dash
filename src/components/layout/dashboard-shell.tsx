'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { Sidebar } from '@/components/layout/sidebar'
import { AppFooter } from '@/components/layout/app-footer'
import { PageLoader } from '@/components/ui/loading'
import { SessionRecoveryScreen } from '@/components/auth/session-recovery-screen'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/hooks/use-fetch'
import { ChangeHistoryControls } from '@/components/layout/change-history-controls'
import { GlobalSearch } from '@/components/layout/global-search'

interface ActiveTestSession {
  sessionId: string
  testId: string
  title: string
  shareToken: string
  startedAt: string
  expiresAt: string | null
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, authError, refreshUser, clearClientCache } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const { data: activeSession, loading: activeSessionLoading } = useFetch<ActiveTestSession | null>(
    !loading && user ? '/api/form-test-sessions/active' : null,
  )
  const visitorOnly = Boolean(user && !user.permissions.some((permission) => permission !== 'password:change'))
  // Ein geteilter Testlink (/form-tests/<token>) ist bewusst KEINE reguläre
  // Dashboard-Seite: Bewerber und frisch eingeladene Agent haben oft noch
  // gar keine Rechte. Vorher landeten genau die im Besucherportal und konnten
  // ihren Test nie öffnen. Die Manage-Ansichten bleiben ausgenommen.
  const isSharedFormTestLink = /^\/form-tests\/(?!manage(?:\/|$))[^/]+\/?$/.test(pathname)

  useEffect(() => {
    if (!loading && !activeSessionLoading && visitorOnly && !isSharedFormTestLink) {
      router.replace('/besucherportal')
    }
  }, [activeSessionLoading, isSharedFormTestLink, loading, router, visitorOnly])

  if (loading) return <PageLoader />
  if (!user) {
    // Wer einen geteilten Testlink öffnet, ohne eingeloggt zu sein, hat keine
    // „kaputte Sitzung“ — er war nie angemeldet. Statt des Recovery-Screens
    // bekommt er den Login mit Rücksprung auf genau diesen Link.
    if (isSharedFormTestLink) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#080808] px-4 py-10">
          <section className="glass-panel-elevated w-full max-w-md rounded-[14px] border border-[#373737]/45 p-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/12 text-[#d4d4d4]">
              <ShieldAlert size={26} />
            </div>
            <h1 className="text-[19px] font-semibold text-white">Anmeldung erforderlich</h1>
            <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[#a6a6a6]">
              Melde dich mit Discord an, um diesen Test zu öffnen. Danach landest du automatisch
              wieder hier.
            </p>
            <div className="mt-5 flex justify-center">
              <Link href={`/login?redirect=${encodeURIComponent(pathname)}`}>
                <Button>Zur Anmeldung</Button>
              </Link>
            </div>
          </section>
        </main>
      )
    }

    return (
      <SessionRecoveryScreen
        message={authError}
        onRetry={refreshUser}
        onClearCache={clearClientCache}
      />
    )
  }
  if (activeSessionLoading) return <PageLoader />

  // Nutzer ohne Dashboard-Rechte bekommen den Test ohne Seitenleiste — die
  // hätte für sie ohnehin keinen Inhalt.
  if (visitorOnly) {
    if (!isSharedFormTestLink) return <PageLoader />
    return (
      <main className="min-h-screen bg-[#080808] px-3 pb-10 pt-6 sm:px-6 lg:px-8">{children}</main>
    )
  }

  const activeTestPath = activeSession ? `/form-tests/${activeSession.shareToken}` : ''
  if (activeSession && pathname !== activeTestPath) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#080808] px-4 py-10">
        <section className="glass-panel-elevated w-full max-w-xl rounded-[14px] border border-[#373737]/45 p-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[14px] border border-[#d4d4d4]/30 bg-[#d4d4d4]/12 text-[#d4d4d4]">
            <ShieldAlert size={28} />
          </div>
          <h1 className="text-[20px] font-semibold text-white">Du hast gerade einen Test laufen.</h1>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-5 text-[#a6a6a6]">
            Während der Test aktiv ist, kannst du keine andere Seite im Dashboard öffnen.
          </p>
          <div className="mt-5 flex justify-center">
            <Link href={activeTestPath}>
              <Button>
                Test fortsetzen
              </Button>
            </Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#080808]">
      <Sidebar />
      <ChangeHistoryControls />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col">
        {/* Rechtsbündig über dem Inhalt: erreichbar von jeder Seite, ohne
            das Layout der einzelnen Ansichten anzufassen. */}
        <div className="hidden justify-end px-3 pt-4 sm:px-6 lg:flex lg:px-8">
          <GlobalSearch />
        </div>
        <div className="w-full flex-1 px-3 pb-10 pt-16 sm:px-6 lg:px-8 lg:pt-3">
          {children}
        </div>
        <AppFooter />
      </main>
    </div>
  )
}
