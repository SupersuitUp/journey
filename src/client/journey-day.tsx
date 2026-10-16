'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DayView, GroupName, ItemKind, ItemView, MediaView, MemberNames, RemovedRow } from '../types.js'
import { formatDay, formatWhen, fromLine } from '../format.js'
import { useJourney } from './context.js'
import { Sheet } from './sheet.js'

const HEADINGS: Record<GroupName, string> = { calls: 'Calls', media: 'Photos and video', texts: 'Texts', shipped: 'Shipped' }
const KIND_LABEL: Record<ItemKind, string> = { call: 'Call', photo: 'Photo', video: 'Video', text: 'Text', shipped: 'Shipped' }
const LABEL = 'text-xs font-medium tracking-wide uppercase'

const nameOf = (names: MemberNames, m: string) => names[m] ?? m
const itemsWord = (n: number) => (n === 1 ? 'item' : 'items')

const NOT_REMOVED = 'Not removed. Try again.'
const NOT_RESTORED = 'Not restored. Try again.'
const SIGNED_OUT = 'You are signed out. Reload to sign in again.'
const REMOVED_ANYWAY = 'Removed, but search could not be updated.'
const NOT_REFRESHED = 'The page could not refresh.'

// What a route said when it refused: its own words when it gave some, and whether it says the
// item was removed all the same (a removal that search could not follow answers 409 that way).
async function refusalOf(res: Response): Promise<{ words: string | null; removed: boolean }> {
  try {
    const body = (await res.json()) as { error?: unknown; removed?: unknown } | null
    return { words: typeof body?.error === 'string' && body.error.trim() ? body.error : null, removed: body?.removed === true }
  } catch {
    return { words: null, removed: false }
  }
}
// What a person is told when a request is refused: the route's own words when it gave some. With
// no session the same tap will fail the same way, so a 401 or a 403 never says to try again. The
// member door of this package answers a stranger with one bare word, which tells a person nothing,
// so that word is read as what it means: signed out.
const DOOR_WORD = 'private'
function refusalWords(status: number, words: string | null, otherwise: string): string {
  if (status !== 401 && status !== 403) return words ?? otherwise
  return words && words !== DOOR_WORD ? words : SIGNED_OUT
}

// How many items the route says are removed now, when it says.
async function countOf(res: Response): Promise<number | null> {
  try {
    const n = ((await res.json()) as { removedCount?: unknown } | null)?.removedCount
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

// The day with one item taken out, for when the server removed it and could not be read again.
// It hides more, never less: an account that may tell of the item is withheld here as it is there.
function without(view: DayView<string>, key: string, count: number | null): DayView<string> {
  const had = view.groups.some((g) => g.items.some((i) => i.key === key))
  return {
    ...view,
    groups: view.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== key) })),
    removedCount: count ?? view.removedCount + (had ? 1 : 0),
    ...(view.account ? { account: null, accountPending: true } : {}),
  }
}
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

function ItemRow({ item, names, busy, confirming, note, onAsk, onKeep, onRemove }: {
  item: ItemView<string>; names: MemberNames; busy: boolean; confirming: boolean; note: string | null; onAsk(): void; onKeep(): void; onRemove(): void
}) {
  const { theme } = useJourney()
  const label = labelOf(item)
  const removeRef = useRef<HTMLButtonElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  // The question takes the place of the button that asked it, so focus goes with it: to Keep,
  // the answer that changes nothing, and back to Remove when the question goes away.
  useEffect(() => {
    if (confirming) keepRef.current?.focus()
    else if (wasConfirming.current) removeRef.current?.focus()
    wasConfirming.current = confirming
  }, [confirming])
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
          <p className="mt-1 text-xs" style={{ color: theme.muted }}>{`${fromLine(item.from ? [item.from] : item.by, names)}${item.others ? ' · Others were present' : ''}`}</p>
        </div>
        {confirming ? (
          <div className="flex shrink-0 flex-col items-end">
            <p className="text-base" style={{ color: theme.ink }}>Remove for everyone?</p>
            <div className="flex gap-1">
              <button type="button" onClick={onRemove} disabled={busy} aria-label={`Yes, remove ${label}`} className="h-11 px-2 text-base underline disabled:opacity-40" style={{ color: theme.danger }}>
                Yes, remove
              </button>
              <button ref={keepRef} type="button" onClick={onKeep} disabled={busy} aria-label={`Keep ${label}`} className="h-11 px-2 text-base underline disabled:opacity-40" style={{ color: theme.muted }}>
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button ref={removeRef} type="button" onClick={onAsk} disabled={busy} aria-label={`Remove ${label}`} className="h-11 shrink-0 px-2 text-base underline disabled:opacity-40" style={{ color: theme.muted }}>
            Remove
          </button>
        )}
      </div>
      {note && <p role="alert" className="mt-1 text-right text-sm" style={{ color: theme.danger }}>{note}</p>}
    </li>
  )
}

// What was removed from a day, read when the sheet opens: a title or a kind, who removed it and
// when, and a way back. Never the item's media. A restore that fails says so on its own row.
function RemovedList({ day, names, onRestored }: { day: string; names: MemberNames; onRestored(removedCount: number | null): void }) {
  const { config, theme } = useJourney()
  const [rows, setRows] = useState<RemovedRow<string>[] | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [rowNote, setRowNote] = useState<{ key: string; text: string } | null>(null)
  const [now] = useState(() => new Date())
  const inFlight = useRef(false)
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
    if (inFlight.current) return
    inFlight.current = true
    setBusyKey(key)
    setRowNote(null)
    try {
      let res: Response
      try {
        res = await fetch(`${base}/item?key=${encodeURIComponent(key)}`, { method: 'POST' })
      } catch {
        setRowNote({ key, text: NOT_RESTORED })
        return
      }
      if (!res.ok) {
        setRowNote({ key, text: refusalWords(res.status, (await refusalOf(res)).words, NOT_RESTORED) })
        return
      }
      onRestored(await countOf(res))
    } finally {
      inFlight.current = false
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
            <li key={r.key} className="border-b py-3" style={{ borderColor: theme.hairline }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[17px]" style={{ color: theme.ink, fontFamily: theme.serif }}>{label}</p>
                  <p className="text-xs" style={{ color: theme.muted }}>{`${KIND_LABEL[r.kind]} · Removed by ${nameOf(names, r.by)} · ${formatWhen(r.at, now)}`}</p>
                </div>
                <button type="button" onClick={() => void restore(r.key)} disabled={busyKey !== null} aria-label={`Restore ${label}`} className="h-11 shrink-0 px-2 text-base underline disabled:opacity-40" style={{ color: theme.ink }}>
                  Restore
                </button>
              </div>
              {rowNote?.key === r.key && <p role="alert" className="mt-1 text-right text-sm" style={{ color: theme.danger }}>{rowNote.text}</p>}
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
// restore the day is read again from the server. What the page says is what happened: a removal
// that failed says so on its own row, in the server's words when it gave some; one that went
// through is never called a failure, whatever happened after it.
export function JourneyDay({ view: initial, names }: { view: DayView<string>; names: MemberNames }) {
  const { config, theme } = useJourney()
  const router = useRouter()
  const [view, setView] = useState(initial)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [rowNote, setRowNote] = useState<{ key: string; text: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  const [now] = useState(() => new Date())
  // A second tap can land before the first has disabled the button, so the lock is not kept in state.
  const inFlight = useRef(false)
  const base = `${config.apiBase}/days/${view.day}`

  // The day as the server now has it, and whether it could be read. The page behind is refreshed
  // too, so the list of days and anything else the app draws from it agree with what was just done.
  // Never rejects: a read that fails is an answer (false), not an error for a caller to forget.
  const reload = async (): Promise<boolean> => {
    try {
      const res = await fetch(base)
      if (!res.ok) return false
      setView((await res.json()) as DayView<string>)
      return true
    } catch {
      return false
    } finally {
      try { router.refresh() } catch { /* the app's router is not this page's to fail on */ }
    }
  }

  const remove = async (key: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusyKey(key)
    setRowNote(null)
    setNote(null)
    try {
      let res: Response
      try {
        res = await fetch(`${base}/item?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
      } catch {
        setRowNote({ key, text: NOT_REMOVED })
        return
      }
      const refused = res.ok ? null : await refusalOf(res)
      // A 409 that says `removed` is a removal that happened: search could not follow, the item is hidden.
      const anyway = refused !== null && res.status === 409 && refused.removed
      if (refused && !anyway) {
        setRowNote({ key, text: refusalWords(res.status, refused.words, NOT_REMOVED) })
        return
      }
      const count = res.ok ? await countOf(res) : null
      const fresh = await reload()
      if (!fresh) setView((had) => without(had, key, count))
      const said = anyway ? refused.words ?? REMOVED_ANYWAY : null
      setNote(fresh ? said : `${said ?? 'Removed.'} ${NOT_REFRESHED} Reload to see the latest.`)
    } finally {
      setConfirmKey(null)
      inFlight.current = false
      setBusyKey(null)
    }
  }

  // The list closes at once: the restore went through. If the day cannot be read again the item
  // cannot be drawn from here, so the count is corrected and a note says where things stand.
  const restored = async (count: number | null) => {
    setSheet(false)
    setRowNote(null)
    setNote(null)
    if (await reload()) return
    setView((had) => ({ ...had, removedCount: count ?? Math.max(0, had.removedCount - 1) }))
    setNote(`Restored. ${NOT_REFRESHED} Reload to see it.`)
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
      {note && <p role="status" className="mt-3 text-sm" style={{ color: theme.muted }}>{note}</p>}
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
                note={rowNote?.key === item.key ? rowNote.text : null}
                onAsk={() => { setRowNote(null); setConfirmKey(item.key) }}
                onKeep={() => setConfirmKey(null)}
                onRemove={() => void remove(item.key)}
              />
            ))}
          </ol>
        </section>
      ))}
      {view.removedCount > 0 && (
        <button type="button" onClick={() => setSheet(true)} className="mt-8 h-11 text-base underline" style={{ color: theme.muted }}>
          {`${view.removedCount} ${itemsWord(view.removedCount)} removed`}
        </button>
      )}
      {sheet && (
        <Sheet title="Removed from this day" onClose={() => setSheet(false)}>
          <RemovedList day={view.day} names={names} onRestored={(count) => { restored(count).catch(() => {}) }} />
        </Sheet>
      )}
    </div>
  )
}
