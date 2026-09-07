import type { Metadata } from 'next'

import { InternalAffairsInvestigations } from '@/components/internal-affairs/internal-affairs-investigations'

export const metadata: Metadata = {
  title: 'Ermittlungsakten · Internal Affairs',
}

export default function InternalAffairsInvestigationsPage() {
  return <InternalAffairsInvestigations />
}
