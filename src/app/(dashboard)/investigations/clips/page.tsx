import type { Metadata } from 'next'

import { BodycamCatalog } from '@/components/investigations/bodycam-catalog'

export const metadata: Metadata = {
  title: 'Bodycam-Katalog',
}

export default function BodycamCatalogPage() {
  return <BodycamCatalog />
}
