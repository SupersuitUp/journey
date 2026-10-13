import { describe, expect, it } from 'vitest'
import { emptyDay } from './day.js'
import { clearOwed, owedOf } from './forget.js'
import type { DayRecord, Item } from './types.js'

type M = 'ada' | 'bo'
const NOW = '2026-10-12T16:00:00.000Z'
const LATER = '2026-10-12T17:00:00.000Z'
const item = (key: string, extra: Partial<Item<M>> = {}): Item<M> => ({ key, kind: 'shipped', at: NOW, by: ['ada'], title: key, addedAt: NOW, ...extra })
const day = (items: Item<M>[], extra: Partial<DayRecord<M>> = {}): DayRecord<M> =>
  ({ ...emptyDay<M>('2026-10-12', NOW), items: Object.fromEntries(items.map((i) => [i.key, i])), ...extra })

describe('owedOf', () => {
  it('is nothing for a day that owes nothing, and for no day at all', () => {
    expect(owedOf(day([item('shipped:a')]))).toEqual({ items: [], account: null })
    expect(owedOf(null)).toEqual({ items: [], account: null })
  })

  it('lists every item that owes a forget, removed or not, and the account', () => {
    const rec = day([item('shipped:a', { owesForget: NOW }), item('shipped:b'), item('shipped:c', { owesForget: LATER, removed: { by: 'bo', at: LATER } })], { accountOwesForget: LATER })
    expect(owedOf(rec)).toEqual({ items: [{ key: 'shipped:a', stamp: NOW }, { key: 'shipped:c', stamp: LATER }], account: LATER })
  })
})

describe('clearOwed', () => {
  const rec = day([item('shipped:a', { owesForget: NOW }), item('shipped:c', { owesForget: LATER })], { accountOwesForget: LATER })

  it('clears the marks search confirmed and leaves the rest', () => {
    const out = clearOwed(rec, { items: [{ key: 'shipped:a', stamp: NOW }], account: null })
    expect(out.items['shipped:a']).not.toHaveProperty('owesForget')
    expect(out.items['shipped:c'].owesForget).toBe(LATER)
    expect(out.accountOwesForget).toBe(LATER)
    expect(out.updatedAt).toBe(rec.updatedAt)
    const all = clearOwed(rec, owedOf(rec))
    expect(owedOf(all)).toEqual({ items: [], account: null })
    expect(all).not.toHaveProperty('accountOwesForget')
  })

  it('leaves a mark that was set again since: that debt is a newer one', () => {
    const out = clearOwed(rec, { items: [{ key: 'shipped:c', stamp: NOW }, { key: 'shipped:gone', stamp: NOW }], account: NOW })
    expect(out).toBe(rec)
  })
})
