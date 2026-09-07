import { NextRequest } from 'next/server'
import { buildOpenApiSpec } from '@/lib/openapi-spec'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const base = `${url.protocol}//${url.host}`
  return Response.json(buildOpenApiSpec(base))
}
