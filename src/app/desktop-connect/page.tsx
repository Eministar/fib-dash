import { redirect } from 'next/navigation'
import { getCurrentAuth } from '@/lib/auth'
import { isValidChallenge, isValidLoopbackPort } from '@/lib/desktop/desktop-auth'
import { DesktopConnectCard } from './desktop-connect-card'

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

function single(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

/** Wird von der Desktop-App im Browser geöffnet, um sie mit dem Konto zu verbinden. */
export default async function DesktopConnectPage({ searchParams }: Props) {
  const params = await searchParams
  const port = single(params.port)
  const state = single(params.state)
  const challenge = single(params.challenge)
  const valid = isValidLoopbackPort(port) && /^[A-Za-z0-9_-]{16,64}$/.test(state) && isValidChallenge(challenge)

  const auth = await getCurrentAuth(false)
  if (valid && (!auth || auth.kind !== 'cookie' || auth.portal)) {
    const back = `/desktop-connect?${new URLSearchParams({ port, state, challenge })}`
    redirect(`/api/auth/discord/login?redirect=${encodeURIComponent(back)}`)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#000000] p-4">
      <DesktopConnectCard
        valid={valid}
        port={port}
        state={state}
        challenge={challenge}
        displayName={auth?.user.displayName ?? ''}
      />
    </div>
  )
}
