'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { BG, INK, SERIF } from './theme.js'

// A sheet that rises from the bottom over the page. It is mounted only while open. Its Close
// button, a tap on the backdrop and Escape all close it.
export function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') latest.current() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" onClick={onClose} />
      <div
        className="relative max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        style={{ backgroundColor: BG, color: INK }}
      >
        <div className="flex items-center justify-between">
          <p className="text-xl" style={{ fontFamily: SERIF, fontWeight: 500 }}>{title}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-3 flex h-11 w-11 items-center justify-center text-2xl">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
