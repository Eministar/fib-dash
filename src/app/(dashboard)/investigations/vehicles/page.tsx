import type { Metadata } from 'next'

import { VehicleRegister } from '@/components/investigations/vehicle-register'

export const metadata: Metadata = {
  title: 'Fahrzeugregister',
}

export default function VehicleRegisterPage() {
  return <VehicleRegister />
}
