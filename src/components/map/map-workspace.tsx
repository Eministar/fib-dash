'use client'

import { useCallback, useRef, useState } from 'react'
import { List, MapPin } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { Button } from '@/components/ui/button'
import { PageLoader } from '@/components/ui/loading'
import { Modal } from '@/components/ui/modal'
import { useAuth } from '@/context/auth-context'
import { useApi } from '@/hooks/use-api'
import { useFetch } from '@/hooks/use-fetch'
import { hasPermission } from '@/lib/permissions'
import type { MapSpot } from '@/lib/map-spots'
import { CityMap, type CityMapHandle } from '@/components/map/city-map'
import { MapLegend } from '@/components/map/map-legend'
import { SpotDetailDialog } from '@/components/map/spot-detail-dialog'
import { SpotEditorDialog, type SpotFormValues } from '@/components/map/spot-editor-dialog'
import { SpotList } from '@/components/map/spot-list'
import { DossierFilter, filterSpotsByDossier } from '@/components/map/dossier-filter'
import { useInvestigationToast } from '@/components/investigations/use-investigation-toast'

export function MapWorkspace() {
  const { user } = useAuth()
  const { toastSuccess, toastError } = useInvestigationToast()
  const { execute, loading: saving } = useApi()

  const canView = hasPermission(user, 'map:view')
  const canManage = hasPermission(user, 'map:manage')

  const mapRef = useRef<CityMapHandle | null>(null)
  const [editorSpot, setEditorSpot] = useState<MapSpot | null>(null)
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [detailSpot, setDetailSpot] = useState<MapSpot | null>(null)
  const [movingSpot, setMovingSpot] = useState<MapSpot | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [dossierId, setDossierId] = useState<string | null>(null)

  const { data, loading, refetch } = useFetch<MapSpot[]>(canView ? '/api/map/spots' : null)
  const allSpots = data ?? []
  // Der Filter wirkt auf Karte, Legende und Liste gemeinsam – sonst zeigt die
  // Legende Zahlen, die auf der Karte nicht zu finden sind.
  const spots = filterSpotsByDossier(allSpots, dossierId)

  const focus = useCallback((spot: MapSpot) => {
    mapRef.current?.focusSpot(spot.id)
  }, [])

  if (!canView) return <UnauthorizedContent />

  const closeEditor = () => {
    setEditorOpen(false)
    setEditorSpot(null)
    setPendingPosition(null)
  }

  const handlePlace = (position: { x: number; y: number }) => {
    setEditorSpot(null)
    setPendingPosition(position)
    setEditorOpen(true)
  }

  const handleSubmit = async (values: SpotFormValues) => {
    const editing = editorSpot
    // Fehler bewusst nicht abfangen: der Dialog zeigt sie am Formular an.
    await execute(editing ? `/api/map/spots/${editing.id}` : '/api/map/spots', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify({
        ...values,
        icon: values.icon.trim() || null,
        ...(editing ? {} : pendingPosition),
      }),
    })
    toastSuccess(
      editing ? 'Markierung gespeichert' : 'Markierung gesetzt',
      editing ? 'Die Änderungen wurden übernommen.' : 'Die Markierung wurde angelegt.',
    )
    closeEditor()
    setDetailSpot(null)
    await refetch()
  }

  const handleMoveTo = async (position: { x: number; y: number }) => {
    if (!movingSpot) return
    try {
      await execute(`/api/map/spots/${movingSpot.id}`, {
        method: 'PATCH',
        body: JSON.stringify(position),
      })
      toastSuccess('Markierung verschoben', `„${movingSpot.title}“ liegt jetzt an der neuen Position.`)
      setMovingSpot(null)
      await refetch()
    } catch (cause) {
      toastError('Verschieben fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  const handleDelete = async () => {
    if (!detailSpot) return
    if (!window.confirm(`Markierung „${detailSpot.title}“ endgültig löschen?`)) return
    try {
      await execute(`/api/map/spots/${detailSpot.id}`, { method: 'DELETE' })
      toastSuccess('Markierung gelöscht', `„${detailSpot.title}“ wurde entfernt.`)
      setDetailSpot(null)
      await refetch()
    } catch (cause) {
      toastError('Löschen fehlgeschlagen', cause instanceof Error ? cause.message : 'Unbekannter Fehler')
    }
  }

  return (
    <div className="mx-auto flex min-h-0 max-w-[1600px] flex-col pb-2">
      <PageHeader
        eyebrow="Einsatzmittel"
        title="Karte"
        description={
          canManage
            ? 'Routen, Schwarzmarkt-Orte und Beobachtungen. Klicke auf eine freie Stelle, um eine Nadel zu setzen.'
            : 'Routen, Schwarzmarkt-Orte und Beobachtungen. Rechtsklick auf eine Nadel öffnet die Details.'
        }
        action={
          <Button variant="outline" className="lg:hidden" onClick={() => setListOpen(true)}>
            <List className="h-4 w-4" />
            Markierungen
          </Button>
        }
      />

      {loading ? (
        <PageLoader />
      ) : (
        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="h-[calc(100dvh-16rem)] min-h-[420px]">
            <CityMap
              ref={mapRef}
              spots={spots}
              canManage={canManage}
              onPlace={handlePlace}
              onOpenDetail={setDetailSpot}
              movingSpot={movingSpot}
              moving={saving}
              onMoveTo={handleMoveTo}
              onCancelMove={() => setMovingSpot(null)}
              pendingPosition={editorOpen ? pendingPosition : null}
            />
          </div>

          <div className="hidden min-h-0 flex-col gap-4 lg:flex">
            <DossierFilter spots={allSpots} value={dossierId} onChange={setDossierId} />
            <MapLegend spots={spots} />
            <SpotList
              spots={spots}
              className="min-h-0 flex-1"
              onFocus={focus}
              onOpenDetail={setDetailSpot}
            />
          </div>
        </div>
      )}

      {/* Auf schmalen Bildschirmen ist rechts kein Platz – dort wandert die Liste in einen Dialog. */}
      <Modal open={listOpen} onClose={() => setListOpen(false)} title="Markierungen" size="lg">
        <div className="mb-3"><DossierFilter spots={allSpots} value={dossierId} onChange={setDossierId} /></div>
        <div className="h-[65dvh]">
          <SpotList
            spots={spots}
            className="border-0 bg-transparent"
            onFocus={(spot) => {
              setListOpen(false)
              focus(spot)
            }}
            onOpenDetail={(spot) => {
              setListOpen(false)
              setDetailSpot(spot)
            }}
          />
        </div>
      </Modal>

      <SpotEditorDialog
        open={editorOpen}
        spot={editorSpot}
        position={editorSpot ? { x: editorSpot.x, y: editorSpot.y } : pendingPosition}
        saving={saving}
        onClose={closeEditor}
        onSubmit={handleSubmit}
      />

      <SpotDetailDialog
        // Beim Verschieben und Bearbeiten tritt die Detailansicht zurück, damit
        // die Karte bzw. der Editor frei liegt.
        spot={movingSpot || editorOpen ? null : detailSpot}
        canManage={canManage}
        busy={saving}
        onClose={() => setDetailSpot(null)}
        onFocus={() => {
          if (detailSpot) focus(detailSpot)
          setDetailSpot(null)
        }}
        onEdit={() => {
          setEditorSpot(detailSpot)
          setPendingPosition(null)
          setEditorOpen(true)
        }}
        onMove={() => {
          if (!detailSpot) return
          setMovingSpot(detailSpot)
          focus(detailSpot)
        }}
        onDelete={handleDelete}
      />

      {spots.length === 0 && !loading && dossierId && (
        <p className="mt-3 text-[12px] text-[#6a6a6a]">
          Diese Dauerakte hat keine Kartenpunkte.{' '}
          <button type="button" className="text-[#c4b5fd] hover:underline" onClick={() => setDossierId(null)}>
            Filter lösen
          </button>
        </p>
      )}

      {allSpots.length === 0 && !loading && canManage && (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-[#6a6a6a]">
          <MapPin className="h-3.5 w-3.5" />
          Noch keine Markierungen. Klicke auf die Karte, um die erste zu setzen.
        </p>
      )}
    </div>
  )
}
