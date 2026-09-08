import type { Metadata } from 'next'
import { CorruptionWorkspace } from '@/components/corruption/corruption-workspace'

export const metadata: Metadata = { title: 'Korruptionskontrollen' }

export default function CorruptionChecksPage() { return <CorruptionWorkspace /> }
