import { connection } from 'next/server'
import { DashboardShell } from '@/components/layout/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await connection()

  return <DashboardShell>{children}</DashboardShell>
}
