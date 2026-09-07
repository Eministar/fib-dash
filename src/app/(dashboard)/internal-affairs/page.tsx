import type { Metadata } from 'next'

import { InternalAffairsWorkspace } from '@/components/internal-affairs/internal-affairs-workspace'

export const metadata: Metadata = {
  title: 'Internal Affairs',
}

export default function InternalAffairsPage() {
  return <InternalAffairsWorkspace />
}
