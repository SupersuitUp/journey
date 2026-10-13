import { DAY_MAX_ITEMS } from './item-rules.js'
import type { ContributeStatus, DayRecord, Item, ItemMedia, NewItem, Outcome } from './types.js'

export const REMOVED_REASON = 'removed by a member'
export const FULL_REASON = 'this day is full'
export const CONTRIBUTE_STATUSES: readonly ContributeStatus[] = ['added', 'merged', 'present', 'refused', 'invalid', 'failed']

export function emptyDay<M extends string>(day: string, now: string): DayRecord<M> {
  return { day, items: {}, createdAt: now, updatedAt: now }
}

/** The item a key names: under its own key first, then as another machine's key for the same call. */
export function findItem<M extends string>(rec: DayRecord<M>, key: string): Item<M> | undefined {
  if (Object.hasOwn(rec.items, key)) return rec.items[key]
  return Object.values(rec.items).find((i) => i.aka?.includes(key))
}

/** The call already on the day that a contributed call is the other recording of, if any. */
export function sameCall<M extends string>(rec: DayRecord<M>, item: NewItem): Item<M> | undefined {
  if (item.kind !== 'call' || !item.meetingKey) return undefined
  return Object.values(rec.items).find((i) => i.kind === 'call' && i.meetingKey === item.meetingKey)
}

/**
 * Whether an item's upload should be handed to the app's pipeline before the day is written. Not
 * when the day already has the key, and not when the same call is removed, was with other people,
 * or already has its recording: filing then would only leave an upload nothing points to.
 */
export function wantsMedia<M extends string>(rec: DayRecord<M>, item: NewItem): boolean {
  if (!item.media || findItem(rec, item.key)) return false
  const twin = sameCall(rec, item)
  return !twin || (!twin.removed && !twin.media && twin.others !== true)
}

/**
 * What placing one item did. `changed` is the key of an item search should hear about again, or
 * null. `narrowed` is true when an item just lost its summaries and recording, so search owes a
 * forget for it. `rec` is a new record whenever anything was written down, and the one handed in
 * otherwise.
 */
export interface Step<M extends string> { rec: DayRecord<M>; result: Outcome; changed: string | null; narrowed: boolean }

const still = <M extends string>(rec: DayRecord<M>, result: Outcome): Step<M> => ({ rec, result, changed: null, narrowed: false })
const said = <M extends string>(m: M, text: string) => ({ [m]: text }) as unknown as Partial<Record<M, string>>

// A call where someone else was there keeps a title and one line: its recording and every summary
// go, and search owes a forget for what it may still hold of them.
function narrow<M extends string>(item: Item<M>, line: string | undefined, now: string): Item<M> {
  const out: Item<M> = { ...item, others: true, owesForget: now }
  delete out.media
  delete out.summaries
  if (!out.line && line) out.line = line
  return out
}

// A day whose item was just narrowed: an account written before may tell of what was stripped, so
// search owes a forget for it as well.
function afterNarrowing<M extends string>(rec: DayRecord<M>, item: Item<M>, now: string): DayRecord<M> {
  const next: DayRecord<M> = { ...rec, items: { ...rec.items, [item.key]: item }, updatedAt: now }
  if (rec.account !== undefined) next.accountOwesForget = now
  return next
}

// The second recording of a call the day already holds. The first contributor's item stays the
// item; the second adds its key, its name and its notes. If either machine says other people were
// present the item is treated as one where they were: no recording, no summaries.
function merge<M extends string>(rec: DayRecord<M>, twin: Item<M>, m: M, item: NewItem, media: ItemMedia | undefined, now: string): Step<M> {
  const narrowed = item.others === true && twin.others !== true
  let merged: Item<M> = { ...twin, aka: [...(twin.aka ?? []), item.key], by: twin.by.includes(m) ? twin.by : [...twin.by, m] }
  if (!merged.title && item.title) merged.title = item.title
  if (narrowed) merged = narrow(merged, item.line, now)
  else if (twin.others === true) {
    delete merged.media
    delete merged.summaries
    if (!merged.line && item.line) merged.line = item.line
  } else {
    if (item.summary) merged.summaries = Object.assign({}, twin.summaries, said(m, item.summary))
    if (!merged.media && media) merged.media = media
  }
  const next: DayRecord<M> = narrowed ? afterNarrowing(rec, merged, now) : { ...rec, items: { ...rec.items, [twin.key]: merged }, updatedAt: now }
  // A written account may tell of what the merge changed, and of what it just stripped.
  if (rec.account !== undefined) {
    next.accountStale = true
    if (narrowed) next.accountWithheld = true
  }
  return { rec: next, result: { key: item.key, status: 'merged' }, changed: twin.key, narrowed }
}

// The second recording of a call a member removed. It is refused like any key that names a removed
// item, and nothing of it is kept. One thing it says still counts: that other people were present.
// The removed call takes that narrowing where it lies, so restoring it later brings back a title
// and one line, never the summaries and recording the rule forbids.
function refuseTwin<M extends string>(rec: DayRecord<M>, twin: Item<M>, item: NewItem, now: string): Step<M> {
  const result: Outcome = { key: item.key, status: 'refused', reason: REMOVED_REASON }
  if (item.others !== true || twin.others === true) return still(rec, result)
  return { rec: afterNarrowing(rec, narrow(twin, item.line, now), now), result, changed: null, narrowed: true }
}

/**
 * One validated item, placed on a day. Already there: nothing changes. Removed by a member:
 * refused for good, under any key that names it (and if it is the other recording of a removed
 * call and says others were present, the removed call is narrowed where it lies). The same call
 * from the other machine: merged.
 * Otherwise added. `media` is what the app's pipeline filed for this item, if it carried an upload.
 */
export function contributeTo<M extends string>(rec: DayRecord<M>, m: M, item: NewItem, media: ItemMedia | undefined, now: string): Step<M> {
  const known = findItem(rec, item.key)
  if (known?.removed) return still(rec, { key: item.key, status: 'refused', reason: REMOVED_REASON })
  if (known) return still(rec, { key: item.key, status: 'present' })
  const twin = sameCall(rec, item)
  if (twin?.removed) return refuseTwin(rec, twin, item, now)
  if (twin) return merge(rec, twin, m, item, media, now)
  if (Object.keys(rec.items).length >= DAY_MAX_ITEMS) return still(rec, { key: item.key, status: 'invalid', reason: FULL_REASON })
  const fresh: Item<M> = {
    key: item.key, kind: item.kind, at: item.at, by: [m],
    ...(item.title ? { title: item.title } : {}),
    ...(item.line ? { line: item.line } : {}),
    ...(item.summary ? { summaries: said(m, item.summary) } : {}),
    ...(item.words ? { words: item.words } : {}),
    ...(item.others ? { others: true as const } : {}),
    ...(item.meetingKey ? { meetingKey: item.meetingKey } : {}),
    ...(media ? { media } : {}),
    addedAt: now,
  }
  return {
    rec: { ...rec, items: { ...rec.items, [item.key]: fresh }, updatedAt: now },
    result: { key: item.key, status: 'added' },
    changed: item.key,
    narrowed: false,
  }
}
