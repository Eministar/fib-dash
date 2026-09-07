'use client'

import { MessageCircle, ShieldCheck } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { useAuth } from '@/context/auth-context'

export default function AccountPage() {
  const { user } = useAuth()

  return (
    <div>
      <PageHeader
        title="Mein Konto"
        description={user?.displayName ?? 'Discord-Profil'}
      />

      <div className="space-y-4 max-w-xl">
        <div className="glass-panel-elevated rounded-[14px] p-6">
          <div className="flex items-center gap-4">
            {user?.avatarUrl ? (
              <span
                className="h-14 w-14 shrink-0 rounded-full bg-cover bg-center ring-1 ring-[#d4d4d4]/25"
                style={{ backgroundImage: `url(${user.avatarUrl})` }}
                aria-label={user.displayName}
              />
            ) : (
              <div className="h-14 w-14 rounded-full bg-[#212121] flex items-center justify-center text-[#d4d4d4]">
                <MessageCircle size={22} strokeWidth={1.75} />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold text-[#eee]">{user?.displayName}</h3>
              <p className="text-[12px] text-[#909090] mt-1">Discord-ID: {user?.discordId ?? 'nicht verbunden'}</p>
            </div>
          </div>
        </div>

        <div className="glass-panel-elevated rounded-[14px] p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-9 w-9 rounded-[9px] bg-[#212121] flex items-center justify-center text-[#d4d4d4]">
              <ShieldCheck size={17} strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-[13.5px] font-semibold text-[#eee]">Berechtigungen</h3>
              <p className="text-[11.5px] text-[#909090] mt-0.5">Gruppen werden bei jedem Login aus deinen Discord-Rollen berechnet.</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(user?.groups ?? []).map((group) => (
              <span key={group.id} className="rounded-[7px] border border-[#404040] bg-[#181818]/70 px-2.5 py-1.5 text-[12px] text-[#f4f4f4]">
                {group.name}
              </span>
            ))}
            {(user?.groups ?? []).length === 0 && (
              <span className="text-[12.5px] text-[#909090]">Keine Benutzergruppe aktiv</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
