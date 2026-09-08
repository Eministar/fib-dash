import type { Metadata } from 'next'

import { MapWorkspace } from '@/components/map/map-workspace'

export const metadata: Metadata = {
  title: 'Karte',
}

export default function MapPage() {
  return <MapWorkspace />
}
