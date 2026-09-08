import type { Metadata } from 'next'
import { ShareManager } from '@/components/investigations/share-manager'
export const metadata: Metadata = { title: 'Freigabelinks' }
export default function SharesPage() { return <ShareManager /> }
