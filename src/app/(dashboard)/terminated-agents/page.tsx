import { redirect } from 'next/navigation'

export default function TerminatedAgentsRedirectPage() {
  redirect('/terminations')
}
