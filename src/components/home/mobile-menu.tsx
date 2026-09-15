'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'

export function MobileMenu() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        document.getElementById('home-menu-toggle')?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  return <div className="mobile-menu">
    <button id="home-menu-toggle" aria-label={open ? 'Menü schließen' : 'Menü öffnen'} aria-expanded={open} aria-controls="home-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
    {open && <nav id="home-mobile-nav" aria-label="Mobile Navigation">
      {['auftrag', 'einheiten', 'kontakt'].map((id, index) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{['Auftrag', 'Einheiten', 'Kontakt'][index]}</a>)}
      <Link href="/dashboard" onClick={() => setOpen(false)}>Dashboard</Link>
    </nav>}
  </div>
}
