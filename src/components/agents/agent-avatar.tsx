'use client'

import { UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

type AgentAvatarProps = {
  agent: {
    firstName: string
    lastName: string
    avatarUrl?: string | null
  }
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  ringColor?: string | null
}

const sizeClasses = {
  xs: 'h-[26px] w-[26px]',
  sm: 'h-[30px] w-[30px]',
  md: 'h-9 w-9',
  lg: 'h-14 w-14',
}

const iconSizes = { xs: 12, sm: 13, md: 15, lg: 21 }

export function AgentAvatar({ agent, size = 'md', className, ringColor }: AgentAvatarProps) {
  const label = `Discord-Profilbild von ${agent.firstName} ${agent.lastName}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border bg-[#232323] bg-cover bg-center text-[#a6a6a6] shadow-[0_2px_8px_rgba(0,0,0,.18)]',
        sizeClasses[size],
        className,
      )}
      style={{
        borderColor: ringColor ? `${ringColor}66` : 'rgba(128,128,128,.7)',
        backgroundImage: agent.avatarUrl ? `url(${agent.avatarUrl})` : undefined,
      }}
    >
      {!agent.avatarUrl && <UserRound size={iconSizes[size]} strokeWidth={1.8} aria-hidden />}
    </span>
  )
}
