'use client'

import { useMemo, useState } from 'react'
import { Video } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Input } from '@/components/ui/input'
import { PageLoader } from '@/components/ui/loading'
import { Select } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/filter-bar'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import { ClipCard, ClipPlayer } from '@/components/investigations/clip-player'
import { InvestigationsNavigation } from '@/components/investigations/investigations-navigation'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'
import type { BodycamClip } from '@/components/investigations/types'

export function BodycamCatalog() {
  const { user } = useAuth()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute } = useApi()

  const { data: access, loading: checkingAccess } = useFetch<{ allowed: boolean; full: boolean }>('/api/investigations/clips/access')
  const canView = access?.allowed === true
  const canManage = hasPermission(user, 'investigations:manage')

  const [search, setSearch] = useState('')
  const [agentId, setAgentId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [activeClip, setActiveClip] = useState<BodycamClip | null>(null)

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('search', search.trim())
    if (agentId) params.set('recordedByAgentId', agentId)
    if (from) params.set('from', new Date(from).toISOString())
    // Bis-Datum einschließlich: sonst fallen alle Clips des Tages heraus.
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString())
    const suffix = params.toString()
    return `/api/investigations/clips${suffix ? `?${suffix}` : ''}`
  }, [search, agentId, from, to])

  const { data, loading, refetch, error } = useFetch<BodycamClip[]>(canView ? query : null)
  const agents = useMemo(() => [...new Map((data ?? []).flatMap(clip => clip.recordedByAgent ? [[clip.recordedByAgent.id, clip.recordedByAgent] as const] : [])).values()], [data])

  const agentOptions = useMemo(
    () => [
      { value: '', label: 'Alle Bodycams' },
      ...(agents ?? []).map((agent) => ({
        value: agent.id,
        label: `${agent.firstName} ${agent.lastName} (${agent.badgeNumber})`,
      })),
    ],
    [agents],
  )

  if (checkingAccess) return <PageLoader />
  if (!canView) return <UnauthorizedContent />

  const handleDelete = async (clip: BodycamClip) => {
    if (!window.confirm(`Clip "${clip.title}" endgültig löschen? Die Videodatei wird dabei entfernt.`)) return

    try {
      await execute(`/api/investigations/clips/${clip.id}`, { method: 'DELETE' })
      toastSuccess('Clip gelöscht', `"${clip.title}" wurde entfernt.`)
      setActiveClip(null)
      await refetch()
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const clips = data ?? []

  return (
    <div className="mx-auto max-w-6xl pb-2">
      {access?.full && <InvestigationsNavigation active="clips" />}

      <PageHeader
        eyebrow="Ermittlungen"
        title="Bodycam-Katalog"
        description="Alle Aufnahmen aus den für dich sichtbaren Ermittlungsakten."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          label="Clip suchen"
          placeholder="Titel, Ort oder Aktenzeichen"
        />
        <Select options={agentOptions} value={agentId} onValueChange={setAgentId} />
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>

      {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}
      {loading ? (
        <PageLoader />
      ) : clips.length === 0 ? (
        <EmptyState
          icon={Video}
          title="Keine Clips gefunden."
          hint="Clips werden in der jeweiligen Einsatzakte hochgeladen und erscheinen dann hier."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onOpen={setActiveClip} showCase />
          ))}
        </div>
      )}

      <ClipPlayer
        clip={activeClip}
        onClose={() => setActiveClip(null)}
        onDelete={canManage ? handleDelete : undefined}
        showCaseLink={access?.full}
      />
    </div>
  )
}
