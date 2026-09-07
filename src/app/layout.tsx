import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')

const ogImage = {
  url: '/op-image.png',
  width: 1983,
  height: 793,
  alt: 'FIB Dashboard',
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'FIB Dashboard',
  title: {
    default: 'FIB Dashboard',
    template: '%s · FIB',
  },
  description: 'Department-Verwaltung, Dienstzeiten, Aufgaben und operative Tools des Federal Investigation Bureau.',
  keywords: [
    'FIB',
    'Federal Investigation Bureau',
    'Department Dashboard',
    'Personalverwaltung',
    'Dienstzeiten',
    'NeroV',
  ],
  icons: {
    icon: '/shield.webp',
    shortcut: '/shield.webp',
    apple: '/shield.webp',
  },
  openGraph: {
    type: 'website',
    locale: 'de_DE',
    url: '/',
    siteName: 'FIB Dashboard',
    title: 'FIB Dashboard',
    description: 'Department-Verwaltung, Dienstzeiten, Aufgaben und operative Tools des Federal Investigation Bureau.',
    images: [ogImage],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FIB Dashboard',
    description: 'Department-Verwaltung, Dienstzeiten, Aufgaben und operative Tools des Federal Investigation Bureau.',
    images: [ogImage],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className="dark">
      <body className="min-h-screen bg-[#080808] bg-pattern text-[#f4f4f4] font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
