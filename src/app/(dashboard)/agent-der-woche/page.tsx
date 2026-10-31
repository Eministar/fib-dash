import type { Metadata } from 'next'
import { AgentOfWeekWorkspace } from '@/components/agent-of-week/agent-of-week-workspace'

export const metadata: Metadata = { title: 'Agent der Woche' }

export default function AgentOfWeekPage() { return <AgentOfWeekWorkspace /> }
