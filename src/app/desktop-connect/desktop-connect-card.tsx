'use client'

import { useState } from 'react'
import { CheckCircle2, MonitorDown, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  valid: boolean
  port: string
  state: string
  challenge: string
  displayName: string
}

export function DesktopConnectCard({ valid, port, state, challenge, displayName }: Props) {
  const [status, setStatus] = useState<'idle' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const connect = async () => {
    try {
      const response = await fetch('/api/desktop/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge }),
      })
      const parsed = (await response.json().catch(() => null)) as { success?: boolean; error?: string; data?: { code: string } } | null
      if (!response.ok || !parsed?.success || !parsed.data) throw new Error(parsed?.error || `HTTP ${response.status}`)
      setStatus('done')
      // Die App wartet lokal auf genau diesem Port auf den Code.
      window.location.href = `http://127.0.0.1:${port}/callback?${new URLSearchParams({ code: parsed.data.code, state })}`
    } catch (cause) {
      setStatus('error')
      setMessage(cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  if (!valid) {
    return (
      <Panel icon={<TriangleAlert size={18} />} title="Ungültiger Link">
        Diese Seite wird von der FIB-Desktop-App geöffnet. Starte die Anmeldung bitte erneut aus der App.
      </Panel>
    )
  }

  if (status === 'done') {
    return (
      <Panel icon={<CheckCircle2 size={18} />} title="Verbunden">
        Die Desktop-App ist jetzt angemeldet. Du kannst dieses Fenster schließen.
      </Panel>
    )
  }

  return (
    <Panel icon={<MonitorDown size={18} />} title="FIB Desktop verbinden">
      <p>
        Die Desktop-App möchte sich mit deinem Konto <span className="font-medium text-white">{displayName}</span> anmelden,
        um Bodycam-Clips hochzuladen.
      </p>
      {status === 'error' && <p className="mt-3 text-[#ff6961]">{message}</p>}
      <div className="mt-5 flex justify-end">
        <Button onClick={connect}>Verbinden</Button>
      </div>
    </Panel>
  )
}

function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel-elevated w-full max-w-[400px] rounded-[16px] p-6">
      <div className="flex items-start gap-3">
        <div className="icon-tile h-10 w-10 shrink-0 rounded-[10px] flex items-center justify-center">{icon}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold text-white">{title}</h1>
          <div className="mt-1.5 text-[12.5px] leading-relaxed text-[#98989d]">{children}</div>
        </div>
      </div>
    </div>
  )
}
