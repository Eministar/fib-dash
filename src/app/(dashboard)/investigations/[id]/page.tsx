import type { Metadata } from 'next'

import { InvestigationDetail } from '@/components/investigations/investigation-detail'

export const metadata: Metadata = {
  title: 'Ermittlungsakte',
}

export default async function InvestigationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <InvestigationDetail investigationId={id} />
}
