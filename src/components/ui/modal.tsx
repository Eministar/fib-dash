'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const sizes = {
  sm: 'max-w-[380px]',
  md: 'max-w-[460px]',
  lg: 'max-w-[560px]',
  xl: 'max-w-[720px]',
}

export function Modal({ open, onClose, title, description, children, className, size = 'md' }: ModalProps) {
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
                initial={{ opacity: 0, scale: 0.96, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 6 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
                  'w-[calc(100%-2rem)]', sizes[size],
                  'glass-panel-elevated rounded-[16px]',
                  'max-h-[85vh] overflow-y-auto',
                  className
                )}
              >
                <div className="p-6">
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
                      <Dialog.Title className="sr-only">Dialog</Dialog.Title>
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
