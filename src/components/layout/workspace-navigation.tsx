import Link from 'next/link'

export function WorkspaceNavigation({ items, active, label }: {
  items: { label: string; href: string; id: string }[]
  active: string
  label: string
}) {
  // Segmented Control wie in macOS – statt Unterstrich-Reitern mit Trennlinie.
  return <nav aria-label={label} className="mb-5 flex max-w-full gap-[2px] overflow-x-auto rounded-[9px] bg-[#1c1c1e] p-[3px] sm:inline-flex">
    {items.map(item => <Link key={item.id} href={item.href} prefetch={false}
      aria-current={active === item.id ? 'page' : undefined}
      className={`shrink-0 whitespace-nowrap rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium transition-colors ${active === item.id ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]' : 'text-[#98989d] hover:text-white'}`}>
      {item.label}
    </Link>)}
  </nav>
}
