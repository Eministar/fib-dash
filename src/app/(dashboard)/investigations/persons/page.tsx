import type { Metadata } from 'next'

import { PersonRegister } from '@/components/investigations/person-register'

export const metadata: Metadata = {
  title: 'Personenregister',
}

export default function PersonRegisterPage() {
  return <PersonRegister />
}
