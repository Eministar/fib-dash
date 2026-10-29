// Dependency-free clip metadata shared by the backend and inbox persistence.
export interface ClipInfo {
  path: string
  name: string
  sizeBytes: number
  durationSeconds: number | null
  savedAt: number
}
