'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Search } from 'lucide-react'
import type { PublicationTable } from '@/lib/publications'

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

/** Öffentliche Tabelle: durchsuchbar und per Klick auf die Überschrift sortierbar. */
export function PublicTable({ table }: { table: PublicationTable }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null)

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query ? table.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(query))) : table.rows
    if (!sort) return filtered
    return [...filtered].sort((a, b) => collator.compare(a[sort.column] ?? '', b[sort.column] ?? '') * (sort.descending ? -1 : 1))
  }, [table.rows, search, sort])

  const toggleSort = (column: number) => setSort((current) => (
    current?.column === column ? (current.descending ? null : { column, descending: true }) : { column, descending: false }
  ))

  return (
    <div>
      {table.rows.length > 8 && (
        <label className="mb-3 flex items-center gap-2 rounded-[10px] border border-[#343434] bg-[#161616] px-3">
          <Search size={15} className="text-[#8c8c8c]" aria-hidden />
          <span className="sr-only">Tabelle durchsuchen</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tabelle durchsuchen …"
            className="h-10 w-full bg-transparent text-[13.5px] text-white outline-none placeholder:text-[#8c8c8c]"
          />
        </label>
      )}
      <div className="overflow-x-auto rounded-[12px] border border-[#343434]">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead className="bg-[#1c1c1c]">
            <tr>
              {table.columns.map((column, index) => (
                <th key={index} scope="col" aria-sort={sort?.column === index ? (sort.descending ? 'descending' : 'ascending') : undefined} className="border-b border-[#343434] p-0 font-medium text-[#d4d4d4]">
                  <button type="button" onClick={() => toggleSort(index)} className="flex w-full items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-left hover:text-white focus-visible:outline focus-visible:outline-2">
                    {column}
                    {sort?.column === index && (sort.descending ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-[#262626] last:border-0 even:bg-[#141414]">
                {row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-pre-wrap px-3 py-2.5 align-top text-[#e5e5e5]">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-[#909090]">{search ? 'Keine Treffer.' : 'Die Tabelle ist leer.'}</p>}
      </div>
      <p className="mt-2 text-[12px] text-[#8c8c8c]">{rows.length} von {table.rows.length} Einträgen</p>
    </div>
  )
}
