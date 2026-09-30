'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, LogIn, LogOut, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'

interface OwnDutyState {
  mode: 'api' | 'manual'
  linked: boolean
  session: { id: string; clockInAt: string; activityCheckDeadline: string | null } | null
}

function formatElapsed(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(totalMinutes / 60)
  return hours > 0 ? `${hours}h ${String(totalMinutes % 60).padStart(2, '0')}m` : `${totalMinutes}m`
}

/** Nur im manuellen Modus sichtbar: eigener Stempelstatus samt Aktivitätsabfrage. */
export function DutyClockCard({ onChange }: { onChange?: () => void }) {
  // Kurzes Intervall, damit die einminütige Aktivitätsabfrage rechtzeitig auftaucht.
  const { data, setData } = useFetch<OwnDutyState>('/api/duty-times/me', 10_000)
  const { execute, loading } = useApi<OwnDutyState>()
  const [failure, setFailure] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!data?.session) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [data?.session])

  if (!data || data.mode !== 'manual' || !data.linked) return null

  const act = async (action: 'clock-in' | 'clock-out' | 'confirm') => {
    setFailure('')
    try {
      const next = await execute('/api/duty-times/me', { method: 'POST', body: JSON.stringify({ action, sessionId: data.session?.id }) })
      if (next) setData(next)
      onChange?.()
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Aktion fehlgeschlagen')
    }
  }

  const session = data.session
  const deadline = session?.activityCheckDeadline ? new Date(session.activityCheckDeadline).getTime() : null
  const secondsLeft = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0

  return (
    <section className="glass-panel-elevated rounded-[14px] px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="icon-tile h-11 w-11 rounded-[12px] flex items-center justify-center">
            <Timer size={20} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-white">
              {session ? `Eingestempelt seit ${formatElapsed(now - new Date(session.clockInAt).getTime())}` : 'Du bist nicht eingestempelt'}
            </p>
            <p className="text-[11.5px] text-[#8e8e93] mt-0.5">Manuelle Erfassung aktiv – auch über die Buttons im Discord-Dienstzeiten-Channel möglich.</p>
          </div>
        </div>
        {session
          ? <Button variant="secondary" size="sm" loading={loading} onClick={() => act('clock-out')}><LogOut size={13} /> Ausstempeln</Button>
          : <Button size="sm" loading={loading} onClick={() => act('clock-in')}><LogIn size={13} /> Einstempeln</Button>}
      </div>

      {deadline && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#3d2d12] bg-[#1d1608]/80 px-3 py-2.5">
          <p className="flex items-center gap-2 text-[12.5px] text-[#f5d38a]">
            <AlertTriangle size={14} />
            Bist du noch im Dienst? Ohne Bestätigung wirst du in {secondsLeft} s automatisch ausgestempelt.
          </p>
          <Button size="sm" loading={loading} onClick={() => act('confirm')}>Ja, noch im Dienst</Button>
        </div>
      )}

      {failure && <p role="alert" className="mt-2 text-[12px] text-[#fca5a5]">{failure}</p>}
    </section>
  )
}
