import type { Metadata } from 'next'

import { LinkGraphView } from '@/components/investigations/link-graph-view'

export const metadata: Metadata = {
  title: 'Netzwerk',
}

export default function InvestigationGraphPage() {
  return <LinkGraphView />
}
