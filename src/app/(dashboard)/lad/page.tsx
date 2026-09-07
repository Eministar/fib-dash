import type { Metadata } from 'next'

import { LegalAffairsWorkspace } from '@/components/legal-affairs/legal-affairs-workspace'

export const metadata: Metadata = {
  title: 'Legal Affairs Division',
}

export default function LegalAffairsPage() {
  return <LegalAffairsWorkspace />
}
