"use client"

import React from 'react'
import { ThemeProvider } from '@/context/theme-context'
import { AuthProvider } from '@/context/auth-context'
import { ToastProvider } from '@/components/ui/toast'
import { ChunkLoadGuard } from '@/components/runtime/chunk-load-guard'
import { ScrollToTop } from '@/components/layout/scroll-to-top'

export default function Providers({ children }: { children: React.ReactNode }) {
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

