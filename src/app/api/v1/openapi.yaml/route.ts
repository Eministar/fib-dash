import { NextRequest } from 'next/server'
import { buildOpenApiSpec } from '@/lib/openapi-spec'

/**
 * OpenAPI 3.1 als YAML. Wird zur Compile-Time aus dem JSON-Spec generiert.
 * Für die YAML-Serialisierung schreiben wir bewusst einen schlanken Konverter
 * (kein zusätzliches npm-Paket nötig), der die Spec-Struktur 1:1 abbildet.
 */
function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (value === null) return 'null'
  if (value === undefined) return 'null'
  if (typeof value === 'string') {
    if (value === '') return '""'
    if (/[:#\n\t]/.test(value) || value === 'true' || value === 'false' || /^\d/.test(value)) {
      return JSON.stringify(value)
    }
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value
      .map((v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const inner = toYaml(v, indent + 1)
          return `${pad}-\n${inner}`
        }
        return `${pad}- ${toYaml(v, indent + 1).trimStart()}`
      })
      .join('\n')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries
      .map(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`
        }
        if (Array.isArray(v) && v.length > 0) {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`
        }
        return `${pad}${k}: ${toYaml(v, indent + 1)}`
      })
      .join('\n')
  }
  return String(value)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const base = `${url.protocol}//${url.host}`
  const spec = buildOpenApiSpec(base)
  const yaml = toYaml(spec)
  return new Response(yaml, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': 'inline; filename="openapi.yaml"',
    },
  })
}
