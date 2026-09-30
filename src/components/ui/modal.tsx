'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { useSyncExternalStore } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Name für Screenreader, wenn der Dialog seine Überschrift selbst rendert. */
  ariaTitle?: string
}

const sizes = {
  sm: 'sm:max-w-[380px]',
  md: 'sm:max-w-[460px]',
  lg: 'sm:max-w-[560px]',
  xl: 'sm:max-w-[720px]',
}

const MOBILE_QUERY = '(max-width: 639px)'

function subscribeMobile(notify: () => void) {
  const media = window.matchMedia(MOBILE_QUERY)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}

/**
 * Enter in einem einfachen Eingabefeld löst den (einzigen) Primär-Knopf des
 * Dialogs aus – wie bei einem echten Formular. Vorher passierte bei Enter in
 * den meisten Dialogen nichts. Bewusst vorsichtig: nicht in Textareas,
 * Such-/Auswahlfeldern, nicht wenn das Feld Enter selbst behandelt und nicht,
 * wenn unklar ist, welcher Knopf gemeint wäre.
 */
function submitOnEnter(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.nativeEvent.isComposing) return
  const target = event.target as HTMLElement
  if (!(target instanceof HTMLInputElement)) return
  if (target.closest('form')) return // echtes Formular: der Browser macht das schon
  const type = target.type
  if (['search', 'checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'].includes(type)) return
  if (target.getAttribute('role') === 'combobox' || target.getAttribute('aria-autocomplete')) return
  const primaries = Array.from(
    // Nur Primär-Knöpfe: Zerstörendes (danger) bleibt bewusst ein Klick.
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-variant="primary"]'),
  ).filter((button) => !button.disabled && button.offsetParent !== null)
  if (primaries.length !== 1) return
  event.preventDefault()
  primaries[0].click()
}

/** Auf dem Handy fährt der Dialog als Sheet von unten ein – dort, wo der Daumen ist. */
function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, () => window.matchMedia(MOBILE_QUERY).matches, () => false)
}

export function Modal({ open, onClose, title, description, children, className, size = 'md', ariaTitle }: ModalProps) {
  const mobile = useIsMobile()
  const hidden = mobile ? { opacity: 1, y: '100%' } : { opacity: 0, scale: 0.96, y: 6 }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 bg-[#080808]/60 backdrop-blur-[2px] z-50"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={hidden}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={hidden}
                transition={mobile ? { type: 'spring', damping: 34, stiffness: 380 } : { duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'fixed z-50',
                  // Handy: Sheet am unteren Rand
                  'inset-x-0 bottom-0 w-full max-h-[90dvh] rounded-t-card rounded-b-none pb-[env(safe-area-inset-bottom)]',
                  // Ab sm: zentrierter Dialog
                  'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2',
                  'sm:w-[calc(100%-2rem)] sm:max-h-[85vh] sm:rounded-card sm:pb-0',
                  sizes[size],
                  'glass-panel-elevated overflow-y-auto overscroll-contain',
                  className
                )}
              >
                <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#404040] sm:hidden" />
                <div className="p-5 sm:p-6" onKeyDown={submitOnEnter}>
                  {title ? (
                    <div className="mb-5">
                      <Dialog.Title className="text-[15px] font-semibold text-white">
                        {title}
                      </Dialog.Title>
                      {description ? (
                        <Dialog.Description className="text-[13px] text-[#a6a6a6] mt-1">
                          {description}
                        </Dialog.Description>
                      ) : (
                        <Dialog.Description className="sr-only">
                          Dialog für {title}
                        </Dialog.Description>
                      )}
                    </div>
                  ) : (
                    <>
                      <Dialog.Title className="sr-only">{ariaTitle ?? 'Dialog'}</Dialog.Title>
                      <Dialog.Description className="sr-only">
                        {description ?? 'Dialogfenster'}
                      </Dialog.Description>
                    </>
                  )}
                  {children}
                </div>
                <Dialog.Close asChild>
                  <button
                    className="absolute top-4 right-4 p-1.5 rounded-[8px] text-[#909090] hover:text-[#d4d4d4] hover:bg-[#232323]/60 transition-colors"
                    aria-label="Schließen"
                  >
                    <X size={15} strokeWidth={2} />
                  </button>
                </Dialog.Close>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
