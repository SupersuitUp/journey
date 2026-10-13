import { DAY_MAX_ITEMS } from './item-rules.js'
import type { ContributeResult, DayRecord, Item, ItemMedia, NewItem } from './types.js'

export const REMOVED_REASON = 'removed by a member'
export const FULL_REASON = 'this day is full'

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

export interface Step<M extends string> { rec: DayRecord<M>; result: ContributeResult; changed: string | null; narrowed: boolean }

const still = <M extends string>(rec: DayRecord<M>, result: ContributeResult): Step<M> => ({ rec, result, changed: null, narrowed: false })
const said = <M extends string>(m: M, text: string) => ({ [m]: text }) as unknown as Partial<Record<M, string>>

// The second recording of a call the day already holds. The first contributor's item stays the
// item; the second adds its key, its name and its notes. If either machine says other people were
// present the item is treated as one where they were: no recording, no summaries.
function merge<M extends string>(rec: DayRecord<M>, twin: Item<M>, m: M, item: NewItem, media: ItemMedia | undefined, now: string): Step<M> {
  const others = twin.others === true || item.others === true
  const merged: Item<M> = { ...twin, aka: [...(twin.aka ?? []), item.key], by: twin.by.includes(m) ? twin.by : [...twin.by, m] }
  if (!merged.title && item.title) merged.title = item.title
  if (others) {
    merged.others = true
    delete merged.media
    delete merged.summaries
    if (!merged.line && item.line) merged.line = item.line
  } else {
    if (item.summary) merged.summaries = Object.assign({}, twin.summaries, said(m, item.summary))
    if (!merged.media && media) merged.media = media
  }
  const narrowed = others && twin.others !== true
  const next: DayRecord<M> = { ...rec, items: { ...rec.items, [twin.key]: merged }, updatedAt: now }
  // A written account may tell of what the merge changed, and of what it just stripped.
  if (rec.account !== undefined) {
    next.accountStale = true
    if (narrowed) next.accountWithheld = true
  }
  return { rec: next, result: { key: item.key, status: 'merged' }, changed: twin.key, narrowed }
}

/**
 * One validated item, placed on a day. Already there: nothing changes. Removed by a member:
 * refused for good, under any key that names it. The same call from the other machine: merged.
 * Otherwise added. `media` is what the app's pipeline filed for this item, if it carried an upload.
 */
export function contributeTo<M extends string>(rec: DayRecord<M>, m: M, item: NewItem, media: ItemMedia | undefined, now: string): Step<M> {
  const known = findItem(rec, item.key)
  if (known?.removed) return still(rec, { key: item.key, status: 'refused', reason: REMOVED_REASON })
  if (known) return still(rec, { key: item.key, status: 'present' })
  const twin = sameCall(rec, item)
  if (twin?.removed) return still(rec, { key: item.key, status: 'refused', reason: REMOVED_REASON })
  if (twin) return merge(rec, twin, m, item, media, now)
  if (Object.keys(rec.items).length >= DAY_MAX_ITEMS) return still(rec, { key: item.key, status: 'failed', reason: FULL_REASON })
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
