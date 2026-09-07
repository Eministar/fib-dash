export interface OrdnungCategoryDTO {
  id: string
  key: string
  label: string
  description: string | null
  icon: string
  color: string
  sortOrder: number
}

export interface OrdnungDTO {
  id: string
  slug: string
  title: string
  description: string
  buttonLabel: string
  icon: string
  categoryId: string
  sortOrder: number
}

export interface OrdnungenPayload {
  categories: OrdnungCategoryDTO[]
  ordnungen: OrdnungDTO[]
}
