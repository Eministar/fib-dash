import type { Metadata } from 'next'

import { QualityCheckDetail } from '@/components/quality/qc-detail'

export const metadata: Metadata = { title: 'Qualitätskontrolle' }

export default async function QualityCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <QualityCheckDetail checkId={id} />
}
