import Link from 'next/link'

export function WorkspaceNavigation({ items, active, label }: {
  items: { label: string; href: string; id: string }[]
  active: string
  label: string
}) {
  return <nav aria-label={label} className="-mx-3 mb-5 flex gap-5 overflow-x-auto border-b border-line px-3 sm:mx-0 sm:px-0">
    {items.map(item => <Link key={item.id} href={item.href} prefetch={false}
      aria-current={active === item.id ? 'page' : undefined}
      className={`shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm transition-colors ${active === item.id ? 'border-accent text-white' : 'border-transparent text-[#909090] hover:text-white'}`}>
      {item.label}
    </Link>)}
  </nav>
}
