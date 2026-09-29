'use client'

import { use } from 'react'
import { UnauthorizedContent } from '@/components/layout/unauthorized-content'
import { PageLoader } from '@/components/ui/loading'
import { PublicationEditor, type PublicationRecord } from '@/components/publications/publication-editor'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { hasPermission } from '@/lib/permissions'

export default function PublicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useAuth()
  const canManage = hasPermission(user, 'publications:manage')
  const isNew = id === 'new'
  // Der Editor übernimmt die Daten nur als Startwert; spätere Aktualisierungen überschreiben keine Eingaben.
  const { data, loading, error } = useFetch<PublicationRecord>(canManage && !isNew ? `/api/publications/${id}` : null)

  if (!canManage) return <UnauthorizedContent />
  if (isNew) return <PublicationEditor />
  if (loading && !data) return <PageLoader />
  if (error || !data) return <p role="alert" className="mx-auto max-w-5xl text-[13px] text-[#fca5a5]">{error || 'Aushang nicht gefunden'}</p>
  return <PublicationEditor key={data.id} existing={data} />
}
