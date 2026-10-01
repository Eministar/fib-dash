import type { Metadata } from 'next'

import { QualityChecksWorkspace } from '@/components/quality/qc-workspace'

export const metadata: Metadata = { title: 'Qualitätskontrollen' }

export default function QualityChecksPage() {
  return <QualityChecksWorkspace />
}
