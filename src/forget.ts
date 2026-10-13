import type { DayRecord } from './types.js'

/** What a day owes search: each item that owes a forget, and the account when it does. */
export interface Owed { items: { key: string; stamp: string }[]; account: string | null }

export const NOTHING_OWED: Owed = { items: [], account: null }

export function owedOf<M extends string>(rec: DayRecord<M> | null | undefined): Owed {
  if (!rec) return { items: [], account: null }
  const items = Object.values(rec.items).flatMap((i) => (i.owesForget !== undefined ? [{ key: i.key, stamp: i.owesForget }] : []))
  return { items, account: rec.accountOwesForget ?? null }
}

/**
 * The day with the debts search confirmed struck off. A mark is cleared only if it is still the
 * one search was asked about: a mark set again since is a newer debt, and stays. Hands back the
 * record it was given when nothing was cleared, so the caller knows there is nothing to write.
 */
export function clearOwed<M extends string>(rec: DayRecord<M>, paid: Owed): DayRecord<M> {
  let next = rec
  for (const p of paid.items) {
    const item = Object.hasOwn(next.items, p.key) ? next.items[p.key] : undefined
    if (!item || item.owesForget !== p.stamp) continue
    const cleared = { ...item }
    delete cleared.owesForget
    next = { ...next, items: { ...next.items, [p.key]: cleared } }
  }
  if (paid.account !== null && next.accountOwesForget === paid.account) {
    next = { ...next }
    delete next.accountOwesForget
  }
  return next
}
