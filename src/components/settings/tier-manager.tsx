'use client'

import { useEffect, useMemo, useState } from 'react'
import { Layers, Plus, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { useFetch } from '@/hooks/use-fetch'
import { useApi } from '@/hooks/use-api'
import { cn } from '@/lib/utils'

interface TierRole {
  id: string
  name: string
}

interface TierRank {
  id: string
  name: string
}

interface Tier {
  id: string
  name: string
  discordRoleId: string | null
  sortOrder: number
  rankIds: string[]
}

interface TierManagerProps {
  roles: TierRole[]
  ranks: TierRank[]
}

/**
 * Verwaltet "Ebenen": eine Discord-Rolle, die Agent mit einem der zugewiesenen
 * Ränge automatisch erhalten. Eigenständige CRUD-UI gegen /api/discord/tiers;
 * Änderungen lösen serverseitig den bestehenden Agent-Rollensync aus.
 */
export function TierManager({ roles, ranks }: TierManagerProps) {
  const { data, loading, refetch } = useFetch<Tier[]>('/api/discord/tiers')
  const { execute } = useApi()
  const { addToast } = useToast()

  const [tiers, setTiers] = useState<Tier[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)
  // Solange lokale, ungespeicherte Änderungen existieren, darf der Live-Refetch
  // (useFetch aktualisiert `data` im Hintergrund) die Bearbeitung nicht überschreiben.
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data && !dirty) setTiers(data)
  }, [data, dirty])

  const roleOptions = useMemo(
    () => [{ value: '', label: 'Keine Rolle' }, ...roles.map((r) => ({ value: r.id, label: r.name }))],
    [roles],
  )

  // rankId → tierId der SPEICHERUNG (aus letztem Fetch), für Grau-out belegter Ränge.
  const rankOwner = useMemo(() => {
    const map = new Map<string, string>()
    for (const tier of data ?? []) {
      for (const rankId of tier.rankIds) map.set(rankId, tier.id)
    }
    return map
  }, [data])

  const updateLocal = (id: string, patch: Partial<Tier>) => {
    setDirty(true)
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  const toggleRank = (tier: Tier, rankId: string) => {
    const has = tier.rankIds.includes(rankId)
    updateLocal(tier.id, {
      rankIds: has ? tier.rankIds.filter((r) => r !== rankId) : [...tier.rankIds, rankId],
    })
  }

  const addTier = async () => {
    try {
      await execute('/api/discord/tiers', {
        method: 'POST',
        body: JSON.stringify({ name: `Neue Ebene ${tiers.length + 1}`, rankIds: [], discordRoleId: null }),
      })
      setDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  const saveTier = async (tier: Tier) => {
    setSavingId(tier.id)
    try {
      await execute(`/api/discord/tiers/${tier.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: tier.name, discordRoleId: tier.discordRoleId, rankIds: tier.rankIds }),
      })
      addToast({ type: 'success', title: 'Ebene gespeichert', message: 'Rollen werden synchronisiert' })
      setDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    } finally {
      setSavingId(null)
    }
  }

  const deleteTier = async (tier: Tier) => {
    if (!confirm(`Ebene „${tier.name}" wirklich löschen?`)) return
    try {
      await execute(`/api/discord/tiers/${tier.id}`, { method: 'DELETE' })
      addToast({ type: 'success', title: 'Ebene gelöscht' })
      setDirty(false)
      await refetch()
    } catch (err) {
      addToast({ type: 'error', title: 'Fehler', message: err instanceof Error ? err.message : '' })
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#aeaeae]">
          <Layers size={14} /> Ebenen
        </p>
        <Button size="sm" variant="secondary" onClick={addTier}>
          <Plus size={13} /> Ebene hinzufügen
        </Button>
      </div>
      <p className="text-[12px] text-[#909090] mb-3">
        Eine Ebene vergibt eine Discord-Rolle automatisch an alle Agent mit einem der zugewiesenen Ränge.
        Jeder Rang gehört zu genau einer Ebene.
      </p>

      {loading && tiers.length === 0 ? (
        <p className="text-[12px] text-[#909090]">Lade Ebenen…</p>
      ) : tiers.length === 0 ? (
        <p className="text-[12px] text-[#808080]">Noch keine Ebenen angelegt.</p>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <div key={tier.id} className="rounded-lg border border-[#343434]/50 bg-[#171717]/60 p-3">
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="flex-1">
                  <Input
                    value={tier.name}
                    placeholder="Name der Ebene"
                    onChange={(e) => updateLocal(tier.id, { name: e.target.value })}
                  />
                </div>
                <div className="sm:w-64">
                  <Select
                    value={tier.discordRoleId || ''}
                    onValueChange={(roleId) => updateLocal(tier.id, { discordRoleId: roleId || null })}
                    options={roleOptions}
                    size="sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ranks.map((rank) => {
                  const selected = tier.rankIds.includes(rank.id)
                  const owner = rankOwner.get(rank.id)
                  const lockedByOther = !selected && owner !== undefined && owner !== tier.id
                  return (
                    <button
                      key={rank.id}
                      type="button"
                      disabled={lockedByOther}
                      onClick={() => toggleRank(tier, rank.id)}
                      title={lockedByOther ? 'Bereits einer anderen Ebene zugeordnet' : undefined}
                      className={cn(
                        'px-2 py-1 rounded text-[12px] border transition-colors',
                        selected
                          ? 'border-[#3b82f6] bg-[#1d4ed8]/25 text-[#dfdfdf]'
                          : lockedByOther
                            ? 'border-[#252525] bg-transparent text-[#545454] cursor-not-allowed'
                            : 'border-[#343434]/60 bg-transparent text-[#aeaeae] hover:border-[#2a5a8f]',
                      )}
                    >
                      {rank.name}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => deleteTier(tier)}
                  className="flex items-center gap-1 text-[12px] text-[#d16a6a] hover:text-[#e88] transition-colors"
                >
                  <Trash2 size={13} /> Löschen
                </button>
                <Button size="sm" onClick={() => saveTier(tier)} disabled={savingId === tier.id}>
                  <Save size={13} /> {savingId === tier.id ? 'Speichere…' : 'Speichern'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
