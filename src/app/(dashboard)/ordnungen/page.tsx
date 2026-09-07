'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Library, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useFetch } from '@/hooks/use-fetch'
import { useAuth } from '@/context/auth-context'
import { ordnungIcon } from '@/lib/ordnungen-icons'
import type { OrdnungenPayload } from '@/lib/ordnungen'
import { OrdnungenManager, type OrdnungenManagerHandle } from '@/components/ordnungen/ordnungen-manager'

function OrdnungCardSkeleton() {
  return (
    <div className="flex items-start gap-4 p-5 glass-panel-elevated rounded-[14px] border border-[#373737]/40">
      <div className="w-12 h-12 rounded-[10px] bg-[#212121] animate-pulse shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3.5 w-2/5 rounded bg-[#212121] animate-pulse" />
        <div className="h-2.5 w-4/5 rounded bg-[#212121]/70 animate-pulse" />
        <div className="h-2.5 w-3/5 rounded bg-[#212121]/70 animate-pulse" />
      </div>
    </div>
  )
}

export default function OrdnungenPage() {
  const { data, refetch } = useFetch<OrdnungenPayload>('/api/ordnungen')
  const { user } = useAuth()
  const canManage = !!user?.permissions.includes('ordnungen:manage')
  const managerRef = useRef<OrdnungenManagerHandle>(null)
  const isLoading = data === undefined
  const categories = data?.categories ?? []
  const ordnungen = data?.ordnungen ?? []
  const total = ordnungen.length

  return (
    <div className="max-w-6xl mx-auto pb-6">
      <PageHeader
        title="Ordnungen & Richtlinien"
        description="Zentrale Sammlung aller relevanten Dienstordnungen und Richtlinien"
      />

      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden glass-panel-elevated rounded-[16px] border border-[#373737]/50 p-6 mb-8"
      >
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(74,143,216,0.18), transparent 70%)' }}
        />
        <div className="relative flex items-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-[14px] bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a] border border-[#404040]/60 text-[#7fb2e8] shrink-0 shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
            <Library size={26} strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-[#f4f4f4]">Regelwerk-Bibliothek</h2>
            <p className="text-[13px] text-[#a6a6a6] mt-0.5">
              {isLoading ? 'Lade Ordnungen …' : `${total} Dokumente in ${categories.length} Bereichen`}
            </p>
          </div>
        </div>
      </motion.div>

      {data && canManage && (
        <OrdnungenManager ref={managerRef} payload={data} canManage={canManage} onChanged={refetch} />
      )}

      {categories.map((category, catIdx) => {
        const categoryOrdnungen = ordnungen.filter((o) => o.categoryId === category.id)
        if (!isLoading && categoryOrdnungen.length === 0) return null

        const accent = category.color
        const accentSoft = `${accent}24`
        const ring = `${accent}59`
        const CategoryIcon = ordnungIcon(category.icon)

        return (
          <div key={category.id} className="mb-9">
            {/* Section header */}
            <div className="flex items-center gap-2.5 mb-4">
              <span
                className="flex items-center justify-center w-7 h-7 rounded-[8px] shrink-0"
                style={{ background: accentSoft, color: accent }}
              >
                <CategoryIcon size={15} strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-[#f4f4f4]">{category.label}</h2>
                  {!isLoading && (
                    <span
                      className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ background: accentSoft, color: accent }}
                    >
                      {categoryOrdnungen.length}
                    </span>
                  )}
                </div>
                {category.description && (
                  <p className="text-[12.5px] text-[#909090] leading-tight">{category.description}</p>
                )}
              </div>
              {canManage && (
                <div className="flex gap-1 ml-auto">
                  <button
                    onClick={() => managerRef.current?.openEditCategory(category)}
                    className="h-7 w-7 grid place-items-center rounded-[7px] bg-[#1a1a1a]/80 text-[#919191] hover:text-[#f4f4f4] transition-colors"
                    title="Kategorie bearbeiten"
                  >
                    <Pencil size={13} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => managerRef.current?.deleteCategory(category.id, category.label)}
                    className="h-7 w-7 grid place-items-center rounded-[7px] bg-[#1a1a1a]/80 text-[#919191] hover:text-[#ff6b6b] transition-colors"
                    title="Kategorie löschen"
                  >
                    <Trash2 size={13} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {isLoading
                ? Array.from({ length: 2 }).map((_, i) => <OrdnungCardSkeleton key={i} />)
                : categoryOrdnungen.map((ordnung, idx) => {
                    const Icon = ordnungIcon(ordnung.icon)
                    return (
                      <motion.div
                        key={ordnung.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: catIdx * 0.06 + idx * 0.05 }}
                      >
                        <Link
                          href={`/ordnungen/${ordnung.slug}`}
                          className="group relative flex items-start gap-4 p-5 glass-panel-elevated rounded-[14px] border border-[#373737]/40 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-ring)] hover:bg-[#212121]/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.28)]"
                          style={{ '--accent-ring': ring, '--accent': accent } as React.CSSProperties}
                        >
                          {/* accent edge */}
                          <span
                            className="absolute left-0 top-5 bottom-5 w-[3px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ background: accent }}
                          />
                          {canManage && (
                            <div className="absolute right-2 top-2 flex gap-1">
                              <button
                                onClick={(e) => { e.preventDefault(); managerRef.current?.openEditOrdnung(ordnung.id) }}
                                className="h-7 w-7 grid place-items-center rounded-[7px] bg-[#1a1a1a]/80 text-[#919191] hover:text-[#f4f4f4] transition-colors"
                                title="Ordnung bearbeiten"
                              >
                                <Pencil size={13} strokeWidth={2} />
                              </button>
                              <button
                                onClick={(e) => { e.preventDefault(); managerRef.current?.deleteOrdnung(ordnung.id, ordnung.title) }}
                                className="h-7 w-7 grid place-items-center rounded-[7px] bg-[#1a1a1a]/80 text-[#919191] hover:text-[#ff6b6b] transition-colors"
                                title="Ordnung löschen"
                              >
                                <Trash2 size={13} strokeWidth={2} />
                              </button>
                            </div>
                          )}
                          <div
                            className="flex items-center justify-center w-12 h-12 rounded-[10px] shrink-0 transition-transform duration-200 group-hover:scale-[1.05]"
                            style={{ background: accentSoft, color: accent }}
                          >
                            <Icon size={20} strokeWidth={1.75} />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className="text-[14px] font-semibold text-[#f2f2f2] group-hover:text-[#fff] transition-colors">
                              {ordnung.title}
                            </h3>
                            <p className="text-[12.5px] text-[#919191] mt-1 leading-relaxed line-clamp-2">
                              {ordnung.description}
                            </p>
                            <span className="inline-flex items-center gap-1 mt-2.5 text-[12px] font-medium text-[#8a8a8a] group-hover:text-[var(--accent)] transition-colors">
                              Öffnen
                              <ArrowRight
                                size={13}
                                strokeWidth={2.25}
                                className="transition-transform duration-200 group-hover:translate-x-0.5"
                              />
                            </span>
                          </div>
                        </Link>
                      </motion.div>
                    )
                  })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
