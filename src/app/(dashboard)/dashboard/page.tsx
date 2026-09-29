import { WorkspaceView } from '@/components/layout/workspace-view'
import { WorkspaceNavigation } from '@/components/layout/workspace-navigation'

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const detailed = (await searchParams).view === 'statistics'
  return <div>
    <WorkspaceNavigation label="Übersicht" active={detailed ? 'details' : 'overview'} items={[
      { id: 'overview', label: 'Übersicht', href: '/dashboard' },
      { id: 'details', label: 'Statistiken', href: '/dashboard?view=statistics' },
    ]} />
    <WorkspaceView area="dashboard" detailed={detailed} />
  </div>
}
