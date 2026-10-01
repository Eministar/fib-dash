import type { Metadata } from 'next'

import { CustodyPrintView } from '@/components/investigations/custody-print-view'

export const metadata: Metadata = {
  title: 'Beweiskette',
}

export default async function EvidenceCustodyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CustodyPrintView evidenceId={id} />
}
