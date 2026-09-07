import type { Metadata } from 'next'
import { NotFoundContent } from '@/components/layout/not-found-content'

export const metadata: Metadata = {
  title: 'Seite nicht gefunden',
  description: 'Die angeforderte Seite existiert nicht.',
}

export default function NotFound() {
  return <NotFoundContent />
}
