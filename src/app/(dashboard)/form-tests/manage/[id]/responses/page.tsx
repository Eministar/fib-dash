'use client'

import { useParams } from 'next/navigation'
import { FormTestResponses } from '@/components/modules/form-test-responses'

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? ''
}

export default function FormTestResponsesPage() {
  const params = useParams<{ id: string | string[] }>()
  const id = paramId(params.id)

  return <FormTestResponses testId={id} />
}
