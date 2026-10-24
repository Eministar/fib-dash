'use client'

import { Download, MonitorDown, RefreshCw, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { PageLoader } from '@/components/ui/loading'
import { useFetch } from '@/hooks/use-fetch'

interface DesktopRelease {
  version: string
  pubDate: string
  size: number
  downloadUrl: string
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unbekanntes Datum'
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function DesktopPage() {
  const { data: release, loading, error, refetch } = useFetch<DesktopRelease | null>('/api/desktop')

  if (loading && !release) return <PageLoader withHeader />

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader title="Desktop-App" description="FIB Desktop für Windows 10 und 11. Die App hält sich selbst aktuell – einmal installieren genügt." />

      {!release ? (
        <EmptyState
          icon={MonitorDown}
          title={error ? 'Release konnte nicht geladen werden' : 'Noch keine Version veröffentlicht'}
          hint={error ?? 'Sobald eine Änderung an der Desktop-App gepusht wurde, erscheint der Installer hier.'}
          action={<Button size="sm" variant="secondary" onClick={() => refetch()}><RefreshCw size={14} />Erneut prüfen</Button>}
        />
      ) : (
        <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="icon-tile h-11 w-11 shrink-0 rounded-[10px] flex items-center justify-center">
            <MonitorDown size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-white">FIB Desktop {release.version}</h2>
            <p className="mt-1 text-[12.5px] text-[#98989d] tabular-nums">
              Veröffentlicht {formatDate(release.pubDate)} · {formatSize(release.size)}
            </p>
          </div>
          <a href={release.downloadUrl} download>
            <Button><Download size={15} />Für Windows herunterladen</Button>
          </a>
        </Card>
      )}

      <Card className="flex gap-3.5">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[#ffd60a]" aria-hidden />
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold text-white">Windows warnt beim ersten Start</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#98989d]">
            Der Installer hat (noch) kein Code-Signing-Zertifikat. Windows SmartScreen zeigt deshalb
            „Der Computer wurde durch Windows geschützt“ und blockiert den Start. Die App ist trotzdem unbedenklich –
            sie kommt direkt aus diesem Dashboard.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-[#98989d]">
            <li>Im Warnfenster auf <span className="text-[#f5f5f7]">Weitere Informationen</span> klicken.</li>
            <li>Unten auf <span className="text-[#f5f5f7]">Trotzdem ausführen</span> klicken.</li>
            <li>Blockiert der Browser schon den Download, dort über das Menü am Download <span className="text-[#f5f5f7]">Behalten</span> wählen.</li>
          </ol>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[#98989d]">Das ist nur bei der ersten Installation nötig – Updates installiert die App danach ohne Nachfrage.</p>
        </div>
      </Card>

      <Card>
        <h3 className="text-[13.5px] font-semibold text-white">So funktioniert’s</h3>
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-[#98989d]">
          <li>Installer starten – die App installiert sich ohne Administratorrechte für dein Benutzerkonto.</li>
          <li>Beim Start und alle zehn Minuten prüft die App, ob es hier eine neue Version gibt.</li>
          <li>Neue Versionen lädt sie selbst herunter, installiert sie und startet neu.</li>
        </ul>
      </Card>
    </div>
  )
}
