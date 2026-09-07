'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SessionRecoveryScreenProps {
  message?: string | null
  onRetry: () => Promise<void>
  onClearCache: () => Promise<void>
}

export function SessionRecoveryScreen({ message, onRetry, onClearCache }: SessionRecoveryScreenProps) {
  const router = useRouter()

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080808] px-4 bg-pattern">
      <div className="w-full max-w-[420px] glass-panel-elevated rounded-[18px] p-6 text-center">
        <div className="mx-auto mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[20px] bg-gradient-to-br from-[#1e1e1e] to-[#161616] border border-[#d4d4d4]/30 shadow-[0_4px_20px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(212,212,212,0.08)]">
          <Image src="/shield.webp" alt="FIB" width={72} height={72} className="rounded-full" priority />
        </div>

        <div className="mb-2 flex items-center justify-center gap-2 text-[#d4d4d4]">
          <ShieldAlert size={17} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Sitzung prüfen</span>
        </div>

        <h1 className="text-[20px] font-semibold text-white">Keine aktive Sitzung gefunden</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[#aeaeae]">
          {message || 'Deine Anmeldung ist abgelaufen oder der lokale Browser-Cache enthält alte Sitzungsdaten.'}
        </p>

        <div className="mt-6 grid grid-cols-1 gap-2.5">
          <Button onClick={onRetry} className="h-[38px]">
            <RefreshCw size={14} strokeWidth={2} />
            Neu laden
          </Button>
          <Button variant="secondary" onClick={onClearCache} className="h-[38px]">
            <Trash2 size={14} strokeWidth={2} />
            Cache löschen
          </Button>
          <Button variant="ghost" onClick={() => router.push('/login')} className="h-[38px]">
            Zum Login
          </Button>
        </div>

        <p className="mt-5 text-[11px] text-[#808080]">
          Cache löschen entfernt lokale Browserdaten dieser App und meldet dich ab.
        </p>
      </div>
    </div>
  )
}
