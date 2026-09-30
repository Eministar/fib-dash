import { PageLoader } from '@/components/ui/loading'

/** Sofortiges Feedback beim Seitenwechsel, solange die Zielroute lädt. */
export default function DashboardLoading() {
  return <PageLoader withHeader />
}
