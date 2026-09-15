"use client"

import React from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider } from '@/context/theme-context'
import { AuthProvider } from '@/context/auth-context'
import { ToastProvider } from '@/components/ui/toast'
import { ChunkLoadGuard } from '@/components/runtime/chunk-load-guard'
import { ScrollToTop } from '@/components/layout/scroll-to-top'

export default function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // The public homepage must work without a session or database setup.
  if (pathname === '/') return <><ChunkLoadGuard />{children}</>

  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <ChunkLoadGuard />
          {children}
          <ScrollToTop />
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

