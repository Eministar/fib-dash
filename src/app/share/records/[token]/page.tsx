import type { Metadata } from 'next'
import { SharedRecordsView } from '@/components/investigations/shared-records-view'
export const metadata: Metadata = { title: 'Freigegebene Unterlagen', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }
export default async function SharedRecordsPage({ params }: { params: Promise<{ token: string }> }) {
  return <SharedRecordsView token={(await params).token} />
}
