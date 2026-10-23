import { cookies } from 'next/headers'
import { success, error } from '@/lib/api-response'

export async function POST() {
  return error('Passwort-Login ist deaktiviert. Bitte Discord-Login nutzen.', 410)
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('auth-token')
  return success({ message: 'Abgemeldet' })
}
