import type { Metadata } from 'next'

import { QualityOfficerFile } from '@/components/quality/qc-officer-file'

export const metadata: Metadata = { title: 'Beamtenakte' }

export default async function QualityOfficerPage({ params }: { params: Promise<{ lspdId: string }> }) {
  const { lspdId } = await params
  return <QualityOfficerFile lspdOfficerId={lspdId} />
}
