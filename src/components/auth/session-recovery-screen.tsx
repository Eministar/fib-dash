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
    <div className="min-h-screen flex items-center justify-center bg-[#000000] px-4 bg-pattern">
      <div className="w-full max-w-[420px] glass-panel-elevated rounded-[18px] p-6 text-center">
        <div className="mx-auto mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-[20px] bg-[#1c1c1e] border border-[#d4d4d4]/30 shadow-[0_4px_20px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(212,212,212,0.08)]">
          <Image src="/shield.webp" alt="FIB" width={72} height={72} className="rounded-full" priority />
        </div>

        <div className="mb-2 flex items-center justify-center gap-2 text-[#d4d4d4]">
          <ShieldAlert size={17} strokeWidth={1.8} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Verbindungsproblem</span>
        </div>

        <h1 className="text-[20px] font-semibold text-white">Anmeldung konnte nicht geprüft werden</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-[#98989d]">
          Der Server hat nicht wie erwartet geantwortet. Meist hilft es, kurz zu warten und neu zu laden.{message ? ` (${message})` : ''}
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

        <p className="mt-5 text-[11px] text-[#8e8e93]">
          Cache löschen entfernt lokale Browserdaten dieser App und meldet dich ab.
        </p>
      </div>
    </div>
  )
}
