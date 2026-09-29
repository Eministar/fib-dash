import { WorkspaceView } from '@/components/layout/workspace-view'
import { WorkspaceNavigation } from '@/components/layout/workspace-navigation'

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const detailed = (await searchParams).view === 'katalog'
  return <div>
    <WorkspaceNavigation label="Sanktionen" active={detailed ? 'details' : 'overview'} items={[
      { id: 'overview', label: 'Sanktionen', href: '/sanktionen' },
      { id: 'details', label: 'Katalog', href: '/sanktionen?view=katalog' },
    ]} />
    <WorkspaceView area="sanctions" detailed={detailed} />
  </div>
}
