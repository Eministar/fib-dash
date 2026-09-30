import { ReactNode } from 'react'
import { Breadcrumbs, type Crumb } from '@/components/layout/breadcrumbs'

interface PageHeaderProps {
    title: string
    description?: string
    eyebrow?: string
    action?: ReactNode
    /** Pfad über dem Titel, z. B. [{ label: 'Agents', href: '/agents' }, { label: name }]. */
    breadcrumbs?: Crumb[]
}

export function PageHeader({ title, description, eyebrow, action, breadcrumbs }: PageHeaderProps) {
    return (
        <div className="mb-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
                    {eyebrow && (
                        <p className="text-xs font-medium text-[#909090] mb-2">
                            {eyebrow}
                        </p>
                    )}
                    <h1 className="text-[22px] sm:text-[24px] font-semibold text-white tracking-[-0.02em] leading-tight">{title}</h1>
                    {description && (
                        <p className="text-[13px] text-fg-muted mt-1.5 max-w-2xl leading-relaxed">{description}</p>
                    )}
                </div>
                {action && <div className="shrink-0 flex flex-wrap gap-2">{action}</div>}
            </div>
            <div className="mt-5 h-px w-full bg-line" />
        </div>
    )
}