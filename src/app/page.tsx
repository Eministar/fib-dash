import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowDown, ArrowUpRight } from 'lucide-react'
import { Cinema } from '@/components/home/cinema'
import { MobileMenu } from '@/components/home/mobile-menu'
import './home.css'

const description = 'Das Federal Investigation Bureau. Unser Auftrag, unsere Einheiten und dein Weg ins FIB.'

export const metadata: Metadata = {
  title: { absolute: 'FIB | Federal Investigation Bureau' },
  description,
  openGraph: { title: 'Federal Investigation Bureau', description, siteName: 'FIB', url: '/' },
  twitter: { title: 'Federal Investigation Bureau', description },
}

// Replace these image slots with the supplied FIB photos when available.
function BureauImage({ hero = false }: { hero?: boolean }) {
  if (hero) return <Image src="/home/banner.png" alt="" fill sizes="(max-width: 700px) 100vw, 70vw" priority className="bureau-photo" />
  return <Image src="/home/fib-seal.png" alt="" fill sizes="(max-width: 700px) 100vw, 60vw" priority={hero} className="bureau-placeholder" />
}

export default function Home() {
  return <div className="fib-home">
    <Cinema />
    <a className="skip-link" href="#auftrag">Zum Inhalt</a>
    <header className="header">
      <a className="brand" href="#fib" aria-label="FIB – Startseite"><Image src="/home/fib-seal.png" alt="FIB-Siegel" width={42} height={42} /><span>Federal Investigation<br />Bureau</span></a>
      <nav className="desktop-nav" aria-label="Hauptnavigation"><a href="#auftrag">Auftrag</a><a href="#einheiten">Einheiten</a><a href="#kontakt">Kontakt</a><Link href="/dashboard">Dashboard <ArrowUpRight size={13} /></Link></nav>
      <MobileMenu />
    </header>
    <main>
      <section className="hero scene" id="fib" aria-labelledby="profile-title">
        <div className="hero-word" aria-hidden="true">FIB</div>
        <div className="hero-portrait portrait"><BureauImage hero /></div>
        <div className="hero-title"><p>Federal Investigation Bureau</p><h1 id="profile-title"><span>F I B</span></h1></div>
        <div className="hero-role"><span className="small-label">Federal Investigation Bureau</span><p>Im Dienst<br />der Sicherheit.</p><span className="duty"><i /> Gemeinsam im Einsatz</span></div>
        <div className="hero-bottom"><a href="#auftrag">Die Menschen hinter dem Auftrag <ArrowDown size={17} /></a><span>For truth. For justice.</span></div>
      </section>
      <section className="career scene" id="auftrag" aria-labelledby="career-title">
        <div className="scene-copy"><p className="small-label reveal">Unser Auftrag</p><h2 id="career-title" className="reveal">Verantwortung<br />bleibt.</h2><div className="career-entries reveal">
          <article><span>Federal Investigation Bureau</span><h3>Ermitteln. Schützen. Aufklären.</h3><p>Wir gehen Hinweisen nach, sichern Beweise und bringen Licht in komplexe Fälle. Für die Sicherheit der Menschen in unserem Staat.</p></article>
          <article><span>Ein gemeinsamer Auftrag</span><h3>Stark als Team</h3><p>Ermittlung, Einsatz und Ausbildung greifen bei uns ineinander. Verantwortung tragen wir gemeinsam.</p></article>
        </div></div>
        <div className="career-picture picture-reveal"><span className="picture-word" aria-hidden="true">FIB</span><div className="portrait"><BureauImage /></div></div>
        <span className="scene-note">Federal Investigation Bureau</span>
      </section>
      <section className="credentials scene" id="einheiten" aria-labelledby="credentials-title">
        <div className="credentials-picture picture-reveal"><div className="portrait"><BureauImage /></div></div>
        <div className="scene-copy"><p className="small-label reveal">Unsere Einheiten</p><h2 id="credentials-title" className="reveal">Kompetenz.<br />Teamgeist.<br />Einsatz.</h2><dl className="degrees reveal">
          <div><dt>Detective Division</dt><dd>Ermittlungen</dd></div><div><dt>Special Response Unit</dt><dd>Spezialeinsätze</dd></div><div><dt>Air Support</dt><dd>Luftunterstützung</dd></div><div><dt>Academy & Human Resources</dt><dd>Ausbildung & Personal</dd></div>
        </dl></div>
      </section>
      <section className="contact scene" id="kontakt" aria-labelledby="contact-title">
        <div className="contact-copy"><p className="small-label reveal">Dein Weg zum FIB</p><h2 id="contact-title" className="reveal">Wir sprechen.</h2><Link className="phone-number reveal contact-link" href="/besucherportal">Kontakt<ArrowUpRight strokeWidth={1} /></Link><div className="reveal"><Link className="copy-button" href="/bewerbung">Beim FIB bewerben <ArrowUpRight size={14} /></Link></div></div>
        <div className="contact-picture picture-reveal"><div className="portrait"><BureauImage /></div></div>
        <div className="contact-signature">Federal Investigation Bureau<span>For truth. For justice.</span></div>
      </section>
    </main>
    <footer><div className="footer-top"><a href="#fib" className="footer-seal"><Image src="/home/fib-seal.png" alt="" width={45} height={45} /><span>For truth. For justice.<br />Federal Investigation Bureau.</span></a><Link className="discord-link" href="/besucherportal">Besucherportal <ArrowUpRight size={14} /></Link><Link className="discord-link" href="/dashboard">Dashboard <ArrowUpRight size={14} /></Link><a className="back-top" href="#fib">Nach oben <ArrowUpRight size={15} /></a></div><div className="footer-bottom"><span>Federal Investigation Bureau</span><p>Fiktive Roleplay-Behörde. Keine Verbindung zu realen Behörden.</p></div></footer>
  </div>
}
