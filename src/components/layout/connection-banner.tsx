'use client'

import { useSyncExternalStore } from 'react'
import { RefreshCw, WifiOff } from 'lucide-react'

import { getConnectionState, subscribeConnection, type ConnectionState } from '@/lib/connection-status'
import { notifyLiveUpdate } from '@/lib/live-updates'

const SERVER_STATE: ConnectionState = { failing: false, lastOkAt: null }

function subscribeOnline(notify: () => void) {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

/**
 * Sagt ehrlich, wenn die angezeigten Daten gerade nicht mehr frisch sind.
 * Vorher liefen die Hintergrund-Updates stumm ins Leere und man arbeitete
 * mit veralteten Listen weiter, ohne es zu merken.
 */
export function ConnectionBanner() {
  const connection = useSyncExternalStore(subscribeConnection, getConnectionState, () => SERVER_STATE)
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)

  if (online && !connection.failing) return null

  const since = connection.lastOkAt
    ? new Date(connection.lastOkAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-amber-500/30 bg-amber-500/[0.08] px-4 py-2.5 text-[12.5px] text-amber-100"
    >
      <WifiOff size={15} className="shrink-0 text-amber-300" />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">{online ? 'Server nicht erreichbar.' : 'Keine Internetverbindung.'}</strong>{' '}
        {since ? `Du siehst den Stand von ${since} Uhr.` : 'Angezeigte Daten sind eventuell veraltet.'} Es wird automatisch erneut versucht.
      </span>
      <button
        type="button"
        onClick={() => notifyLiveUpdate()}
        className="inline-flex items-center gap-1.5 rounded-[7px] border border-amber-400/30 px-2.5 py-1 font-medium text-amber-100 transition-colors hover:bg-amber-400/10"
      >
        <RefreshCw size={13} />
        Jetzt versuchen
      </button>
    </div>
  )
}
