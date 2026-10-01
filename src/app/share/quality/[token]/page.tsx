import type { Metadata } from 'next'

import { QualitySharedView } from '@/components/quality/qc-shared-view'

export const metadata: Metadata = {
  title: 'Freigegebene Qualitätskontrollen',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function SharedQualityPage({ params }: { params: Promise<{ token: string }> }) {
  return <QualitySharedView token={(await params).token} />
}
