'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DayView, GroupName, ItemKind, ItemView, MediaView, MemberNames, RemovedRow } from '../types.js'
import { formatDay, formatWhen, fromLine } from '../format.js'
import { useJourney } from './context.js'
import { Sheet } from './sheet.js'

const HEADINGS: Record<GroupName, string> = { calls: 'Calls', media: 'Photos and video', texts: 'Texts', shipped: 'Shipped' }
const KIND_LABEL: Record<ItemKind, string> = { call: 'Call', photo: 'Photo', video: 'Video', text: 'Text', shipped: 'Shipped' }
const LABEL = 'text-xs font-medium tracking-wide uppercase'

const nameOf = (names: MemberNames, m: string) => names[m] ?? m
const clip = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text)
// What an item is called on its controls: its title, else its first words, else its kind.
const labelOf = (item: { kind: ItemKind; title?: string; words?: string }) => item.title ?? (item.words ? clip(item.words) : KIND_LABEL[item.kind])

function Media({ media, label }: { media: MediaView; label: string }) {
  if (media.kind === 'video' && media.videoUrl) {
    return <video controls preload="none" playsInline poster={media.displayUrl ?? undefined} src={media.videoUrl} aria-label={label} className="mt-2 w-full rounded-xl" />
  }
  const src = media.displayUrl ?? media.thumbUrl
  // eslint-disable-next-line @next/next/no-img-element -- signed, expiring storage URL
  return src ? <img src={src} alt={label} className="mt-2 w-full rounded-xl" /> : null
}

function ItemRow({ item, names, busy, confirming, onAsk, onKeep, onRemove }: {
  item: ItemView<string>; names: MemberNames; busy: boolean; confirming: boolean; onAsk(): void; onKeep(): void; onRemove(): void
}) {
  const { theme } = useJourney()
  const label = labelOf(item)
  return (
    <li className="border-b py-3" style={{ borderColor: theme.hairline }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {item.title && <p className="text-[17px] leading-snug" style={{ color: theme.ink, fontFamily: theme.serif }}>{item.title}</p>}
          {item.line && <p className="mt-1 text-[15px] leading-snug" style={{ color: theme.ink }}>{item.line}</p>}
          {item.words && <blockquote className="border-l-2 pl-3 text-[17px] leading-snug" style={{ color: theme.ink, borderColor: theme.hairline, fontFamily: theme.serif }}>{item.words}</blockquote>}
          {item.summaries.map((s) => (
            <p key={s.by} className="mt-1 text-[15px] leading-snug" style={{ color: theme.ink }}>
              <span style={{ color: theme.muted }}>{nameOf(names, s.by)}: </span>{s.text}
            </p>
          ))}
          {item.media && <Media media={item.media} label={label} />}
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>{`${fromLine(item.by, names)}${item.others ? ' · Others were present' : ''}`}</p>
        </div>
        {confirming ? (
          <div className="flex shrink-0 flex-col items-end">
            <p className="text-base" style={{ color: theme.ink }}>Remove for everyone?</p>
            <div className="flex gap-1">
              <button type="button" onClick={onRemove} disabled={busy} aria-label={`Confirm remove ${label}`} className="h-11 px-2 text-base underline disabled:opacity-40" style={{ color: theme.danger }}>
                Yes, remove
              </button>
              <button type="button" onClick={onKeep} disabled={busy} aria-label={`Keep ${label}`} className="h-11 px-2 text-base underline disabled:opacity-40" style={{ color: theme.muted }}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onAsk} disabled={busy} aria-label={`Remove ${label}`} className="h-11 shrink-0 px-2 text-base underline disabled:opacity-40" style={{ color: theme.muted }}>
            Remove
          </button>
        )}
      </div>
    </li>
  )
}

// What was removed from a day, read when the sheet opens: a title or a kind, who removed it and
// when, and a way back. Never the item's media.
function RemovedList({ day, names, onRestored }: { day: string; names: MemberNames; onRestored(): void }) {
  const { config, theme } = useJourney()
  const [rows, setRows] = useState<RemovedRow<string>[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [now] = useState(() => new Date())
  const base = `${config.apiBase}/days/${day}`

  useEffect(() => {
    let live = true
    fetch(`${base}/removed`)
      .then(async (res) => {
        if (!res.ok) throw new Error('failed')
        return (await res.json()) as { removed: RemovedRow<string>[] }
      })
      .then((body) => { if (live) setRows(body.removed) })
      .catch(() => { if (live) setNote('Could not load what was removed. Close this and try again.') })
    return () => { live = false }
  }, [base])

  const restore = async (key: string) => {
    if (busyKey) return
    setBusyKey(key)
    setNote(null)
    try {
      const res = await fetch(`${base}/item?key=${encodeURIComponent(key)}`, { method: 'POST' })
      if (!res.ok) throw new Error('failed')
      onRestored()
    } catch {
      setNote('Not restored. Try again.')
      setBusyKey(null)
    }
  }

  return (
    <div className="pt-2">
      {note && <p role="alert" className="py-2 text-sm" style={{ color: theme.danger }}>{note}</p>}
      {rows && rows.length === 0 && <p className="py-6 text-center text-[17px]" style={{ color: theme.muted, fontFamily: theme.serif }}>Nothing is removed.</p>}
      <ol>
        {(rows ?? []).map((r) => {
          const label = r.title ?? KIND_LABEL[r.kind]
          return (
            <li key={r.key} className="flex items-center justify-between gap-3 border-b py-3" style={{ borderColor: theme.hairline }}>
              <div className="min-w-0">
                <p className="truncate text-[17px]" style={{ color: theme.ink, fontFamily: theme.serif }}>{label}</p>
                <p className="text-xs" style={{ color: theme.muted }}>{`${KIND_LABEL[r.kind]} · Removed by ${nameOf(names, r.by)} · ${formatWhen(r.at, now)}`}</p>
              </div>
              <button type="button" onClick={() => void restore(r.key)} disabled={busyKey !== null} aria-label={`Restore ${label}`} className="h-11 shrink-0 px-2 text-base underline disabled:opacity-40" style={{ color: theme.ink }}>
                Restore
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// One day: the account on top, then calls, photos and video, texts and shipped work, each item
// marked with whose machine it came from. Every item has a Remove control, for either member, and
// removing asks once first. Removing hides the item for everyone and is quiet; a line at the foot
// says how many were removed, and opens the list where one can be put back. After a removal or a
// restore the day is read again from the server, so the page never shows a guess.
export function JourneyDay({ view: initial, names }: { view: DayView<string>; names: MemberNames }) {
  const { config, theme } = useJourney()
  const router = useRouter()
  const [view, setView] = useState(initial)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [now] = useState(() => new Date())
  const base = `${config.apiBase}/days/${view.day}`

  // The day as the server now has it. The page behind is refreshed too, so the list of days and
  // anything else the app draws from it agree with what was just done.
  const reload = async () => {
    const res = await fetch(base)
    if (res.ok) setView((await res.json()) as DayView<string>)
    router.refresh()
  }

  const remove = async (key: string) => {
    if (busyKey) return
    setBusyKey(key)
    setNote(null)
    try {
      const res = await fetch(`${base}/item?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setConfirmKey(null)
      await reload()
    } catch {
      setConfirmKey(null)
      setNote('Not removed. Try again.')
    } finally {
      setBusyKey(null)
    }
  }

  const groups = view.groups.filter((g) => g.items.length > 0)
  return (
    <div className="px-4 pb-10">
      <p className={LABEL} style={{ color: theme.muted }}>{formatDay(view.day, now)}</p>
      {view.account ? (
        <div className="mt-2 space-y-3">
          {view.account.text.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="text-[17px] leading-relaxed whitespace-pre-line" style={{ color: theme.ink, fontFamily: theme.serif }}>{para}</p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[17px]" style={{ color: theme.muted, fontFamily: theme.serif }}>
          {view.accountPending ? 'The account of this day is being written again.' : 'This day has not been written up yet.'}
        </p>
      )}
      {note && <p role="alert" className="mt-3 text-sm" style={{ color: theme.danger }}>{note}</p>}
      {groups.map((g) => (
        <section key={g.name} aria-label={HEADINGS[g.name]} className="mt-8">
          <h2 className={LABEL} style={{ color: theme.muted }}>{HEADINGS[g.name]}</h2>
          <ol>
            {g.items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                names={names}
                busy={busyKey !== null}
                confirming={confirmKey === item.key}
                onAsk={() => { setNote(null); setConfirmKey(item.key) }}
                onKeep={() => setConfirmKey(null)}
                onRemove={() => void remove(item.key)}
              />
            ))}
          </ol>
        </section>
      ))}
      {view.removedCount > 0 && (
        <button type="button" onClick={() => setSheet(true)} className="mt-8 h-11 text-base underline" style={{ color: theme.muted }}>
          {`${view.removedCount} ${view.removedCount === 1 ? 'item' : 'items'} removed`}
        </button>
      )}
      {sheet && (
        <Sheet title="Removed from this day" onClose={() => setSheet(false)}>
          <RemovedList day={view.day} names={names} onRestored={() => { setSheet(false); void reload() }} />
        </Sheet>
      )}
    </div>
  )
}
