'use client'

import { useMemo, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'
import { displayBadgeNumber } from '@/lib/badge-number'

interface Agent {
  id: string
  firstName: string
  lastName: string
  badgeNumber: string
  rank: { name: string }
}

const exports = [
  { title: 'Agent-Roster', description: 'Alle Agents als CSV', href: '/api/exports?type=agents&format=csv' },
  { title: 'Wochenbericht Dienstzeiten', description: 'Spielzeit und Sessions der aktuellen Woche als CSV', href: '/api/exports?type=duty-week&format=csv' },
  { title: 'Sanktionen', description: 'Sanktionsliste mit Status, Fristen, Geldstrafen oder SG-Runden als CSV', href: '/api/exports?type=sanctions&format=csv' },
  { title: 'Beförderungen / Degradierungen', description: 'Rangwechsel-Historie als CSV', href: '/api/exports?type=promotions&format=csv' },
]

export default function ExportsPage() {
  const { user } = useAuth()
  const canView = hasPermission(user, 'exports:view')
  const { data: agents } = useFetch<Agent[]>(canView ? '/api/agents' : null)
  const [agentId, setAgentId] = useState('')

  const agentOptions = useMemo(() => (agents ?? []).map((agent) => ({
    value: agent.id,
    label: `${agent.firstName} ${agent.lastName} #${displayBadgeNumber(agent.badgeNumber)} (${agent.rank.name})`,
  })), [agents])

  if (!canView) return <UnauthorizedContent />

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <PageHeader title="Exporte" description="CSV-Downloads und druckfertige Agent-Akten für PDF-Ausgabe" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {exports.map((item) => (
          <div key={item.href} className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-4">
            <div className="flex items-start gap-3">
              <div className="icon-tile h-9 w-9 rounded-[9px] flex items-center justify-center">
                <Download size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-semibold text-white">{item.title}</h3>
                <p className="mt-1 text-[12.5px] text-[#a6a6a6]">{item.description}</p>
                <a href={item.href} className="mt-3 inline-flex">
                  <Button size="sm">CSV herunterladen</Button>
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="glass-panel-elevated rounded-[14px] border border-[#373737]/45 p-5">
        <div className="flex items-start gap-3">
          <div className="icon-tile h-9 w-9 rounded-[9px] flex items-center justify-center">
            <FileText size={16} />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h3 className="text-[14px] font-semibold text-white">Agent-Akte</h3>
              <p className="mt-1 text-[12.5px] text-[#a6a6a6]">CSV oder druckfertige HTML-Ansicht. Die HTML-Ansicht kann über den Browser als PDF gedruckt werden.</p>
            </div>
            <Select label="Agent" value={agentId} onValueChange={setAgentId} options={agentOptions} placeholder="Agent wählen..." />
            <div className="flex flex-wrap gap-2">
              <a href={agentId ? `/api/exports?type=agent&format=csv&agentId=${agentId}` : undefined}>
                <Button size="sm" disabled={!agentId}>Akte als CSV</Button>
              </a>
              <a href={agentId ? `/api/exports?type=agent&format=html&agentId=${agentId}` : undefined} target="_blank" rel="noreferrer">
                <Button size="sm" variant="secondary" disabled={!agentId}>PDF-Druckansicht</Button>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
