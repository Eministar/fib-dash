import type { Metadata } from 'next'

import { InvestigationsWorkspace } from '@/components/investigations/investigations-workspace'

export const metadata: Metadata = {
  title: 'Einsatzakten',
}

export default function InvestigationsPage() {
  return <InvestigationsWorkspace />
}
