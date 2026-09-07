import type { Metadata } from 'next'
import { VisitorPortal } from '@/components/portal/visitor-portal'

export const metadata: Metadata = {
  title: 'Besucherportal',
  description: 'Öffentlicher Bereich für Bewerbungen, Pressemitteilungen und Mitarbeiterliste.',
}

export default function VisitorPortalPage() {
  return <VisitorPortal />
}
