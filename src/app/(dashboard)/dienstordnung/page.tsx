import { redirect } from 'next/navigation'

// Die frühere Dienstordnung-Einzelseite wurde zur zentralen Ordnungen-Übersicht
// umfunktioniert. Die einzelne Dienstordnung ist weiterhin unter
// /ordnungen/dienstordnung erreichbar.
export default function DienstordnungPage() {
  redirect('/ordnungen')
}
