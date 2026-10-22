import { StorageLogEntryView } from '@/components/leadership/storage-log-entry'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  return <StorageLogEntryView slug={(await params).slug.toUpperCase()} />
}
