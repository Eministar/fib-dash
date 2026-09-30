import type { Metadata } from 'next'
import { InvestigationTemplates } from '@/components/investigations/investigation-templates'

export const metadata: Metadata = { title: 'Aktenvorlagen' }

export default function Page() {
  return <InvestigationTemplates />
}
