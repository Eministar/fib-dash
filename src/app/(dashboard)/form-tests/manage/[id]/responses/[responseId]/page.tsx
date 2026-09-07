'use client'

import { useParams } from 'next/navigation'
import { FormTestResponseDetail } from '@/components/modules/form-test-response-detail'

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function FormTestResponseDetailPage() {
  const params = useParams<{ id: string | string[]; responseId: string | string[] }>()
  const id = paramId(params.id)
  const responseId = paramId(params.responseId)

  return <FormTestResponseDetail testId={id} responseId={responseId} />
}
