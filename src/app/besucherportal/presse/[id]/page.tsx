import { VisitorPortal } from '@/components/portal/visitor-portal'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <VisitorPortal section="presse" pressId={(await params).id} />
}
