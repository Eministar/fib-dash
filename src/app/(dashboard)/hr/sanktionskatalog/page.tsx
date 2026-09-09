import { redirect } from 'next/navigation'

export default function SanktionskatalogPage() {
  // Der Katalog liegt seit Version 1.0 im Sanktionsbereich.
  redirect('/sanktionen/katalog')
}
