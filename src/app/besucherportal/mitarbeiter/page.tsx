import { redirect } from 'next/navigation'

// Die öffentliche Mitarbeiterliste wurde aus dem Besucherportal entfernt; alte Links landen auf der Startseite.
export default function Page() {
  redirect('/besucherportal')
}
