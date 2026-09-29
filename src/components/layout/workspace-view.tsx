'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/ui/loading'

const Overview = dynamic(() => import('@/components/dashboard/overview'), { loading: PageLoader })
const Statistics = dynamic(() => import('@/components/dashboard/statistics'), { loading: PageLoader })
const Sanctions = dynamic(() => import('@/components/sanctions/sanctions-overview'), { loading: PageLoader })
const Catalog = dynamic(() => import('@/components/sanctions/sanction-catalog'), { loading: PageLoader })

export function WorkspaceView({ area, detailed }: { area: 'dashboard' | 'sanctions'; detailed: boolean }) {
  if (area === 'dashboard') return detailed ? <Statistics /> : <Overview />
  return detailed ? <Catalog /> : <Sanctions />
}
