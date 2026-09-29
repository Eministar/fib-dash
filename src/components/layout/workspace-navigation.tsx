import Link from 'next/link'

export function WorkspaceNavigation({ items, active, label }: {
  items: { label: string; href: string; id: string }[]
  active: string
  label: string
}) {
  return <nav aria-label={label} className="mb-5 flex gap-5 border-b border-[#343434]">
    {items.map(item => <Link key={item.id} href={item.href} prefetch={false}
      aria-current={active === item.id ? 'page' : undefined}
      className={`border-b-2 px-1 py-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 ${active === item.id ? 'border-[#d4d4d4] text-white' : 'border-transparent text-[#909090] hover:text-white'}`}>
      {item.label}
    </Link>)}
  </nav>
}
