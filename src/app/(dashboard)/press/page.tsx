import type { Metadata } from 'next'
import { PressSpeakerWorkspace } from '@/components/press/press-speaker-workspace'

export const metadata: Metadata = {
  title: 'Pressesprecherbereich',
  description: 'Pressemitteilungen schreiben, bebildern und veröffentlichen.',
}

export default function PressPage() {
  return <PressSpeakerWorkspace />
}
