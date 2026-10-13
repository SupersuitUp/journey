import { RuleError } from './errors.js'
import { findItem } from './day.js'
import type { DayRecord, Item, RemovedRow } from './types.js'

const byTime = <T extends { at: string; key: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** What is on a day: every item nobody removed, oldest first. Every read of a day starts here. */
export function visibleOf<M extends string>(rec: DayRecord<M>): Item<M>[] {
  return Object.values(rec.items).filter((i) => !i.removed).sort(byTime)
}

/** What was removed, most recent first: enough to recognise an item and put it back, never its media. */
export function removedOf<M extends string>(rec: DayRecord<M>): RemovedRow<M>[] {
  return Object.values(rec.items)
    .filter((i) => i.removed)
    .map((i): RemovedRow<M> => ({ key: i.key, kind: i.kind, ...(i.title ? { title: i.title } : {}), by: i.removed!.by, at: i.removed!.at }))
    .sort((a, b) => -byTime(a, b))
}

const held = <M extends string>(rec: DayRecord<M>, key: string): Item<M> => {
  const item = findItem(rec, key)
  if (!item) throw new RuleError('no such item on this day', 404)
  return item
}

/**
 * Either member removes any item. Removing hides: the item stays in the record with who removed it
 * and when, every read leaves it out, and its key is refused if a machine sends it again. A day
 * that was already written up may tell of the item, so its account is withheld until rewritten.
 * Search may hold the item and that account, so both are marked as owing a forget.
 */
export function removeFrom<M extends string>(rec: DayRecord<M>, m: M, key: string, now: string): { rec: DayRecord<M>; key: string; changed: boolean; hadAccount: boolean } {
  const item = held(rec, key)
  const hadAccount = rec.account !== undefined
  if (item.removed) return { rec, key: item.key, changed: false, hadAccount }
  const next: DayRecord<M> = { ...rec, items: { ...rec.items, [item.key]: { ...item, removed: { by: m, at: now }, owesForget: now } }, updatedAt: now }
  if (hadAccount) {
    next.accountStale = true
    next.accountWithheld = true
    next.accountOwesForget = now
  }
  return { rec: next, key: item.key, changed: true, hadAccount }
}

/**
 * Puts a removed item back as it was. The account is stale again, since there is more to tell. A
 * forget the item still owes stays owed: search is asked to forget before it hears of the item again.
 */
export function restoreIn<M extends string>(rec: DayRecord<M>, key: string, now: string): { rec: DayRecord<M>; key: string; changed: boolean } {
  const item = held(rec, key)
  if (!item.removed) return { rec, key: item.key, changed: false }
  const back: Item<M> = { ...item }
  delete back.removed
  const next: DayRecord<M> = { ...rec, items: { ...rec.items, [item.key]: back }, updatedAt: now }
  if (rec.account !== undefined) next.accountStale = true
  return { rec: next, key: item.key, changed: true }
}
