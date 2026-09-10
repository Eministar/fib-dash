export interface Upload {
  id: string
  title: string
  description: string | null
  category: string | null
  tags: string[]
  externalRef: string | null
  externalUrl: string | null
  externalUser: string | null
  metadata: Record<string, unknown>
  filename: string
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  createdAt: string
  updatedAt: string
  viewUrl: string
  uploadKey: { id: string; name: string } | null
  uploadedBy: { id: string; displayName: string } | null
  duplicateOf?: { id: string; title: string } | null
}

export interface UploadList {
  items: Upload[]
  total: number
  page: number
  pageSize: number
  categories: string[]
}

export interface UploadKeyRow {
  id: string
  name: string
  prefix: string
  description: string | null
  defaultCategory: string | null
  expiresAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  lastUsedAt: string | null
  usageCount: number
  createdAt: string
  createdBy: { id: string; displayName: string } | null
  _count: { uploads: number }
}
