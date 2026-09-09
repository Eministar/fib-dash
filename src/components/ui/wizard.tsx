'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type WizardStep = {
  id: string
  label: string
  optional?: boolean
  /** Meldung, warum der Schritt noch nicht abgeschlossen werden kann. */
  invalid?: string
  content: React.ReactNode
}

/**
 * Trägt beide Anlegen-Flows. Beim Anlegen (`linear`) führt der Wizard
 * Schritt für Schritt; beim Bearbeiten (`free`) ist jeder Schritt direkt
 * erreichbar und Speichern jederzeit möglich – für eine Tippfehlerkorrektur
 * soll niemand durch fünf Schritte klicken müssen.
 */
export function Wizard({
  steps,
  mode,
  submitLabel,
  saving = false,
  failure,
  onCancel,
  onSubmit,
}: {
  steps: WizardStep[]
  mode: 'linear' | 'free'
  submitLabel: string
  saving?: boolean
  failure?: string
  onCancel: () => void
  onSubmit: () => void
}) {
  const [index, setIndex] = useState(0)
  const current = steps[index]
  const last = index === steps.length - 1
  const blocked = current.invalid
  const firstBlocking = steps.find((step) => step.invalid)

  return (
    <div className="space-y-5">
      <ol className="flex flex-wrap gap-1.5" aria-label="Schritte">
        {steps.map((step, position) => {
          const done = position < index
          const reachable = mode === 'free' || position <= index
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable || saving}
                onClick={() => setIndex(position)}
                aria-current={position === index ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                  position === index
                    ? 'border-[#a78bfa] bg-[#a78bfa]/10 text-white'
                    : done
                      ? 'border-[#343434] text-[#a6a6a6]'
                      : 'border-[#282828] text-[#6a6a6a]',
                  reachable && !saving ? 'hover:border-[#4a4a4a]' : 'cursor-default',
                )}
              >
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#232323] font-mono text-[10px]">
                  {done ? <Check className="h-2.5 w-2.5" /> : position + 1}
                </span>
                {step.label}
                {step.optional && <span className="text-[10.5px] text-[#6a6a6a]">optional</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div>{current.content}</div>

      {blocked && <p role="alert" className="text-[12.5px] text-[#fca5a5]">{blocked}</p>}
      {failure && <p role="alert" className="text-[12.5px] text-red-300">{failure}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#232323] pt-4">
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          Abbrechen
        </Button>

        <div className="flex flex-wrap gap-2">
          {index > 0 && (
            <Button type="button" variant="outline" disabled={saving} onClick={() => setIndex(index - 1)}>
              Zurück
            </Button>
          )}
          {!last && (
            <Button
              type="button"
              variant={current.optional ? 'outline' : 'primary'}
              disabled={saving || Boolean(blocked)}
              onClick={() => setIndex(index + 1)}
            >
              {current.optional ? 'Überspringen' : 'Weiter'}
            </Button>
          )}
          {(last || mode === 'free') && (
            <Button
              type="button"
              loading={saving}
              disabled={Boolean(firstBlocking)}
              onClick={onSubmit}
              title={firstBlocking ? firstBlocking.invalid : undefined}
            >
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
