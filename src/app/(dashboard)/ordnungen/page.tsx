'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { SearchInput } from '@/components/ui/filter-bar'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { ordnungIcon } from '@/lib/ordnungen-icons'
import type { OrdnungenPayload } from '@/lib/ordnungen'
import { OrdnungenManager, type OrdnungenManagerHandle } from '@/components/ordnungen/ordnungen-manager'

function IconButton({ label, danger, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => { event.preventDefault(); onClick() }}
      aria-label={label}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-[7px] text-[#919191] transition-colors hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 ${danger ? 'hover:text-[#ff6b6b]' : 'hover:text-white'}`}
    >
      {children}
    </button>
  )
}

export default function OrdnungenPage() {
  const { data, refetch } = useFetch<OrdnungenPayload>('/api/ordnungen')
  const { user } = useAuth()
  const canManage = !!user?.permissions.includes('ordnungen:manage')
  const managerRef = useRef<OrdnungenManagerHandle>(null)
  const [search, setSearch] = useState('')
  const isLoading = data === undefined

  const sections = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (data?.categories ?? []).map((category) => ({
      category,
      items: (data?.ordnungen ?? []).filter((ordnung) => ordnung.categoryId === category.id && (
        !query || `${ordnung.title} ${ordnung.description} ${category.label}`.toLowerCase().includes(query)
      )),
    })).filter((section) => section.items.length > 0 || (canManage && !search.trim()))
  }, [data, search, canManage])
  const matches = sections.reduce((sum, section) => sum + section.items.length, 0)

  return (
    <div className="mx-auto max-w-4xl pb-6">
      <PageHeader
        title="Ordnungen & Richtlinien"
        description={isLoading ? 'Lade Ordnungen …' : `${data?.ordnungen.length ?? 0} Dokumente in ${data?.categories.length ?? 0} Bereichen. Jede Ordnung hat ein Inhaltsverzeichnis mit allen Abschnitten.`}
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Ordnung suchen, z. B. Sanktion oder Dienstordnung" className="flex-1" />
        {data && canManage && <OrdnungenManager ref={managerRef} payload={data} canManage={canManage} onChanged={refetch} />}
      </div>

      {isLoading && <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-16 animate-pulse rounded-[12px] bg-[#1c1c1c]" />)}</div>}

      {!isLoading && matches === 0 && search.trim() && (
        <p className="rounded-[12px] border border-[#343434] px-4 py-8 text-center text-[13px] text-[#909090]">Keine Ordnung passt zu „{search.trim()}“.</p>
      )}

      <div className="space-y-8">
        {sections.map(({ category, items }) => {
          const CategoryIcon = ordnungIcon(category.icon)
          return (
            <section key={category.id} aria-labelledby={`kategorie-${category.id}`}>
              <div className="mb-2 flex items-center gap-2.5 px-1">
                <CategoryIcon size={15} strokeWidth={2} style={{ color: category.color }} aria-hidden />
                <h2 id={`kategorie-${category.id}`} className="text-[13.5px] font-semibold text-[#f4f4f4]">{category.label}</h2>
                <span className="text-[12px] text-[#808080]">{items.length}</span>
                {canManage && (
                  <div className="ml-auto flex">
                    <IconButton label="Kategorie bearbeiten" onClick={() => managerRef.current?.openEditCategory(category)}><Pencil size={13} /></IconButton>
                    <IconButton label="Kategorie löschen" danger onClick={() => managerRef.current?.deleteCategory(category.id, category.label)}><Trash2 size={13} /></IconButton>
                  </div>
                )}
              </div>
              {category.description && <p className="mb-2 px-1 text-[12px] text-[#909090]">{category.description}</p>}

              {items.length === 0
                ? <p className="rounded-[12px] border border-dashed border-[#343434] px-4 py-4 text-[12.5px] text-[#808080]">Noch keine Ordnung in diesem Bereich.</p>
                : (
                  <ul className="divide-y divide-[#2c2c2c] overflow-hidden rounded-[12px] border border-[#343434] bg-[#161616]">
                    {items.map((ordnung) => {
                      const Icon = ordnungIcon(ordnung.icon)
                      return (
                        <li key={ordnung.id} className="group flex items-center gap-2 pr-2 hover:bg-[#1e1e1e]">
                          <Link href={`/ordnungen/${ordnung.slug}`} className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 focus-visible:outline focus-visible:outline-2">
                            <Icon size={18} strokeWidth={1.75} className="shrink-0" style={{ color: category.color }} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-medium text-[#f2f2f2]">{ordnung.title}</span>
                              <span className="mt-0.5 block truncate text-[12.5px] text-[#909090]">{ordnung.description}</span>
                            </span>
                            <ChevronRight size={16} className="shrink-0 text-[#6f6f6f] group-hover:text-white" aria-hidden />
                          </Link>
                          {canManage && (
                            <div className="flex shrink-0">
                              <IconButton label={`${ordnung.title} bearbeiten`} onClick={() => managerRef.current?.openEditOrdnung(ordnung.id)}><Pencil size={13} /></IconButton>
                              <IconButton label={`${ordnung.title} löschen`} danger onClick={() => managerRef.current?.deleteOrdnung(ordnung.id, ordnung.title)}><Trash2 size={13} /></IconButton>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
