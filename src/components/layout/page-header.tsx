import { ReactNode } from 'react'
import { Breadcrumbs, type Crumb } from '@/components/layout/breadcrumbs'

interface PageHeaderProps {
    title: string
    description?: string
    eyebrow?: string
    action?: ReactNode
    /** Pfad über dem Titel, z. B. [{ label: 'Agents', href: '/agents' }, { label: name }]. */
    breadcrumbs?: Crumb[]
    /** Steht links neben dem Titelblock, z. B. ein Avatar. */
    leading?: ReactNode
    /** Kleine Kennzeichnung direkt hinter dem Titel, z. B. ein Status-Badge. */
    badge?: ReactNode
}

export function PageHeader({ title, description, eyebrow, action, breadcrumbs, leading, badge }: PageHeaderProps) {
    return (
        <div className="mb-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3.5">
                    {leading && <div className="shrink-0">{leading}</div>}
                    <div className="min-w-0">
                        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
                        {eyebrow && (
                            <p className="text-xs font-medium text-[#8e8e93] mb-2">
                                {eyebrow}
                            </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <h1 className="text-[22px] sm:text-[24px] font-semibold text-white tracking-[-0.02em] leading-tight">{title}</h1>
                            {badge}
                        </div>
                        {description && (
                            <p className="text-[13px] text-[#98989d] mt-1.5 max-w-2xl leading-relaxed">{description}</p>
                        )}
                    </div>
                </div>
                {action && <div className="shrink-0 flex flex-wrap gap-2">{action}</div>}
            </div>
        </div>
    )
}
