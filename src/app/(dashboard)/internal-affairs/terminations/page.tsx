import type { Metadata } from 'next'

import { InternalAffairsTerminationsPage } from '@/components/internal-affairs/internal-affairs-terminations-page'

export const metadata: Metadata = {
  title: 'Kündigungen · Internal Affairs',
}

export default function InternalAffairsTerminationsRoute() {
  return <InternalAffairsTerminationsPage />
}
