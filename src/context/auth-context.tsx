'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface User {
  id: string
  username: string
  displayName: string
  discordId: string | null
  avatarUrl: string | null
  groups: { id: string; name: string }[]
  permissions: string[]
}

interface AuthContextType {
  user: User | null
  loading: boolean
  authError: string | null
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  clearClientCache: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// Minimaler Abstand zwischen zwei stillen Revalidierungen (Navigation/Fokus),
// damit schnelle Klick-Folgen nicht /api/auth/me hämmern.
const REVALIDATE_THROTTLE_MS = 3000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  const lastFetchRef = useRef(0)
  const setupRequiredRef = useRef<boolean | null>(null)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)

  // Lädt den aktuellen User aus /api/auth/me.
  // `silent`: kein globaler Loading-State und kein Zurücksetzen bei
  // transienten Netzwerkfehlern — für Hintergrund-Revalidierung, damit die
  // UI nicht bei jeder Navigation flackert.
  const loadUser = useCallback(async (silent: boolean) => {
    if (!silent) setLoading(true)
    lastFetchRef.current = Date.now()
    try {
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sitzung konnte nicht geprüft werden')
      }

      // data.data ist `null`, wenn keine gültige Sitzung mehr besteht — dann
      // gilt der User auch im Silent-Modus als ausgeloggt.
      setUser(data.data ?? null)
      setAuthError(null)
    } catch (err) {
      if (!silent) {
        setUser(null)
        setAuthError(err instanceof Error ? err.message : 'Sitzung konnte nicht geprüft werden')
      }
      // Silent: aktuellen Stand behalten (z.B. kurzzeitiger Netzwerkfehler).
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const refreshUser = useCallback(() => loadUser(false), [loadUser])

  const revalidateUser = useCallback(() => {
    if (setupRequiredRef.current !== false) return
    if (Date.now() - lastFetchRef.current < REVALIDATE_THROTTLE_MS) return
    void loadUser(true)
  }, [loadUser])

  // Vor jedem Auth-/DB-Zugriff prüfen, ob die Installation eingerichtet ist.
  // Dadurch kann eine komplett leere Installation starten, ohne dass Prisma
  // bereits beim ersten Rendern an einer fehlenden DATABASE_URL scheitert.
  useEffect(() => {
    const controller = new AbortController()
    const loadBootstrapState = async () => {
      try {
        const response = await fetch('/api/setup/status', {
          cache: 'no-store',
          signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok || !payload.success) throw new Error(payload.error || 'Einrichtungsstatus konnte nicht geladen werden')

        const required = payload.data?.setupRequired === true
        setupRequiredRef.current = required
        setSetupRequired(required)
        if (required) {
          setUser(null)
          setAuthError(null)
          setLoading(false)
          return
        }
        await loadUser(false)
      } catch (error) {
        if (controller.signal.aborted) return
        setUser(null)
        setAuthError(error instanceof Error ? error.message : 'Einrichtungsstatus konnte nicht geladen werden')
        setLoading(false)
      }
    }
    void loadBootstrapState()

    return () => controller.abort()
  }, [loadUser])

  useEffect(() => {
    if (setupRequired === true && pathname !== '/setup') {
      router.replace('/setup')
    } else if (setupRequired === false && pathname === '/setup') {
      router.replace('/login')
    }
  }, [pathname, router, setupRequired])

  // Bei jedem Seitenwechsel die Rechte still neu auflösen, damit z.B. frisch
  // über eine Benutzergruppe vergebene Permissions ohne Re-Login greifen.
  const didMountRef = useRef(false)
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true
      return
    }
    revalidateUser()
  }, [pathname, revalidateUser])

  // Beim Zurückkehren zum Tab / Fensterfokus ebenfalls revalidieren, damit ein
  // offener Tab Rechteänderungen mitbekommt, ohne dass navigiert werden muss.
  useEffect(() => {
    const onFocus = () => revalidateUser()
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidateUser()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [revalidateUser])

  const logout = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' })
    setUser(null)
    setAuthError(null)
    router.push('/login')
  }

  const clearClientCache = async () => {
    await fetch('/api/auth/login', { method: 'DELETE' }).catch(() => undefined)

    if (typeof window !== 'undefined') {
      window.localStorage.clear()
      window.sessionStorage.clear()

      if ('caches' in window) {
        const cacheNames = await window.caches.keys()
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)))
      }
    }

    setUser(null)
    setAuthError(null)
    router.push('/login')
    router.refresh()
  }

  return (
    <AuthContext.Provider value={{ user, loading, authError, logout, refreshUser, clearClientCache }}>
      {children}
    </AuthContext.Provider>
  )
}
