'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { DayRow, DaysPage } from '../types.js'
import { clientConfig } from './config.js'
import { formatDay } from './format-day.js'
import { ACCENT, DANGER, HAIRLINE, INK, MUTED, SERIF } from './theme.js'

const countLine = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}, not written up yet`

// The list of days, newest first: the date, the first line of the day's account, and a strip of
// that day's media. The app hands in the first page it read on the server; earlier pages are
// fetched here by the date cursor. Which days are new to this person is the app's to know, so it
// arrives as `newDays`. No row prefetches its page: each is a dynamic render with signed media.
export function JourneyHome({ days, next, newDays = [], empty = 'Nothing here yet. A day appears once something from it is contributed.' }: {
  days: DayRow[]; next: string | null; newDays?: readonly string[]; empty?: string
}) {
  const [rows, setRows] = useState(days)
  const [cursor, setCursor] = useState(next)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [now] = useState(() => new Date())

  const more = async () => {
    if (!cursor || busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`${clientConfig().apiBase}/days?before=${encodeURIComponent(cursor)}`)
      if (!res.ok) throw new Error('failed')
      const page = (await res.json()) as DaysPage
      setRows((had) => [...had, ...page.days])
      setCursor(page.next)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (rows.length === 0 && !cursor) {
    return <p className="px-6 py-12 text-center text-[17px]" style={{ color: MUTED, fontFamily: SERIF }}>{empty}</p>
  }
  return (
    <div className="px-4">
      <ol>
        {rows.map((d) => (
          <li key={d.day} className="border-b" style={{ borderColor: HAIRLINE }}>
            <Link href={`${clientConfig().pageBase}/${d.day}`} prefetch={false} className="block py-4">
              <p className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase" style={{ color: MUTED }}>
                <span>{formatDay(d.day, now)}</span>
                {newDays.includes(d.day) && <span aria-label="New" role="img" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ACCENT }} />}
              </p>
              <p className="mt-1 text-[17px] leading-snug" style={{ color: INK, fontFamily: SERIF }}>{d.firstLine ?? countLine(d.count)}</p>
              {d.thumbs.length > 0 && (
                <ul className="mt-3 grid grid-cols-4 gap-1.5">
                  {d.thumbs.map((src, i) => (
                    <li key={i} className="aspect-square overflow-hidden rounded-xl" style={{ backgroundColor: HAIRLINE }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL */}
                      <img src={src} alt="" className="h-full w-full object-cover" />
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          </li>
        ))}
      </ol>
      {cursor && (
        <button type="button" onClick={() => void more()} disabled={busy} className="mt-4 h-11 w-full rounded-xl text-base disabled:opacity-40" style={{ color: INK, border: `1px solid ${HAIRLINE}` }}>
          {busy ? 'Loading' : 'Earlier days'}
        </button>
      )}
      {failed && <p role="alert" className="mt-2 text-center text-sm" style={{ color: DANGER }}>Could not load earlier days. Try again.</p>}
    </div>
  )
}
