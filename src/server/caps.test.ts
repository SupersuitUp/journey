// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DAY_MAX_BYTES, FULL_REASON, dayBytes } from '../day.js'
import { AKA_MAX, DAY_MAX_ITEMS, ITEMS_PER_CALL, SUMMARY_MAX } from '../item-rules.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const DAY = '2026-10-12'
const AT = '2026-10-12T10:00:00-05:00'
const shipped = (n: number) => ({ key: `shipped:r${n}`, kind: 'shipped', at: AT, title: `Released ${n}` })
// Three bytes a character, so a full summary weighs three times its length.
const heavy = (n: number) => ({ key: `conversations:c${n}`, kind: 'call', at: AT, title: `Call ${n}`, summary: '€'.repeat(SUMMARY_MAX) })

function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  return { ...h, store, stored }
}

describe('a day holds at most 300 items', () => {
  it('answers what is past the limit as invalid, keeps what fit, and says so on every resend', async () => {
    const { store, stored } = setup()
    for (let from = 0; from < DAY_MAX_ITEMS; from += ITEMS_PER_CALL) {
      await store.contribute('ada', DAY, { items: Array.from({ length: ITEMS_PER_CALL }, (_, i) => shipped(from + i)) })
    }
    expect(Object.keys(stored().items)).toHaveLength(DAY_MAX_ITEMS)
    const over = await store.contribute('bo', DAY, { items: [shipped(0), shipped(1000), shipped(1001)] })
    expect(over.results).toEqual([
      { index: 0, key: 'shipped:r0', status: 'present' },
      { index: 1, key: 'shipped:r1000', status: 'invalid', reason: FULL_REASON },
      { index: 2, key: 'shipped:r1001', status: 'invalid', reason: FULL_REASON },
    ])
    expect(Object.keys(stored().items)).toHaveLength(DAY_MAX_ITEMS)
    expect((await store.contribute('bo', DAY, { items: [shipped(1000)] })).results[0].status).toBe('invalid')
  })

  it('a removed item still takes its place: removal hides and never deletes', async () => {
    const { store } = setup()
    for (let from = 0; from < DAY_MAX_ITEMS; from += ITEMS_PER_CALL) {
      await store.contribute('ada', DAY, { items: Array.from({ length: ITEMS_PER_CALL }, (_, i) => shipped(from + i)) })
    }
    await store.remove('bo', DAY, 'shipped:r0')
    expect((await store.contribute('bo', DAY, { items: [shipped(1000)] })).results[0]).toMatchObject({ status: 'invalid', reason: FULL_REASON })
  })
})

describe('a day stays under the size of one record', () => {
  // Each heavy call weighs a little over 3,600 bytes, so 225 of them come to about 850,000: under
  // the threshold, with room for a dozen more and not for twenty.
  const FILLED = 225
  const fill = async (store: ReturnType<typeof setup>['store']) => {
    const statuses: string[] = []
    for (let from = 0; from < FILLED; from += 45) {
      const answer = await store.contribute('ada', DAY, { items: Array.from({ length: 45 }, (_, i) => heavy(from + i)) })
      statuses.push(...answer.results.map((r) => r.status))
    }
    return statuses
  }

  it('fills up to the threshold with every item kept', async () => {
    const { store, stored } = setup()
    expect((await fill(store)).every((s) => s === 'added')).toBe(true)
    expect(dayBytes(stored())).toBeLessThan(DAY_MAX_BYTES)
    expect(dayBytes(stored())).toBeGreaterThan(DAY_MAX_BYTES - ITEMS_PER_CALL * 3 * SUMMARY_MAX)
  })

  it('answers the items that would push it over as invalid, writes the day without them, and still takes a small one', async () => {
    const { store, stored } = setup()
    await fill(store)
    const answer = await store.contribute('bo', DAY, { items: [...Array.from({ length: 20 }, (_, i) => heavy(500 + i)), shipped(1)] })
    const statuses = answer.results.map((r) => r.status)
    const kept = statuses.slice(0, 20).filter((s) => s === 'added').length
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(20)
    // What fit came first, and everything after the first that did not fit was too large as well.
    expect(statuses.slice(0, 20)).toEqual([...Array(kept).fill('added'), ...Array(20 - kept).fill('invalid')])
    expect(answer.results[kept]).toEqual({ index: kept, key: `conversations:c${500 + kept}`, status: 'invalid', reason: FULL_REASON })
    expect(statuses[20]).toBe('added')
    const rec = stored()
    expect(Object.keys(rec.items)).toHaveLength(FILLED + kept + 1)
    expect(Object.keys(rec.items).length).toBeLessThan(DAY_MAX_ITEMS)
    expect(dayBytes(rec)).toBeLessThanOrEqual(DAY_MAX_BYTES)
    expect(rec.items).not.toHaveProperty(`conversations:c${500 + kept}`)
    expect(answer.refused).toEqual([])
  })

  // A day seeded fifty bytes under the threshold, holding one call. Any merge into that call adds
  // more than fifty bytes (a second key alone is longer), so the guard is what decides.
  const nearlyFull = (s: ReturnType<typeof setup>) => {
    const NOW = '2026-10-12T16:00:00.000Z'
    const rec: DayRecord<M> = {
      day: DAY, createdAt: NOW, updatedAt: NOW,
      items: {
        'conversations:a1': { key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', by: ['ada'], title: 'Weekly sync', meetingKey: 'mk-1', addedAt: NOW },
        'messages:pad': { key: 'messages:pad', kind: 'text', at: '2026-10-12T15:00:00.000Z', by: ['ada'], words: '', addedAt: NOW },
      },
    }
    rec.items['messages:pad'].words = 'x'.repeat(DAY_MAX_BYTES - 50 - dayBytes(rec))
    expect(dayBytes(rec)).toBe(DAY_MAX_BYTES - 50)
    s.f.seed('journey', { [DAY]: rec })
  }
  const second = { key: `conversations:${'b'.repeat(280)}`, kind: 'call', at: AT, title: 'Weekly sync', meetingKey: 'mk-1' }

  it('a merge that only adds is held to the size like anything else', async () => {
    const s = setup()
    nearlyFull(s)
    const answer = await s.store.contribute('bo', DAY, { items: [second] })
    expect(answer.results).toEqual([{ index: 0, key: second.key, status: 'invalid', reason: FULL_REASON }])
    expect(s.stored().items['conversations:a1']).not.toHaveProperty('aka')
  })

  it('never holds back a narrowing for want of room', async () => {
    const s = setup()
    nearlyFull(s)
    const answer = await s.store.contribute('bo', DAY, { items: [{ ...second, others: true, line: 'x'.repeat(200) }] })
    expect(answer.results[0].status).toBe('merged')
    expect(s.stored().items['conversations:a1']).toMatchObject({ others: true, aka: [second.key] })
    expect(dayBytes(s.stored())).toBeGreaterThan(DAY_MAX_BYTES)
    expect(dayBytes(s.stored())).toBeLessThan(1_048_576)
  })
})

describe('a call answers to at most eight other keys', () => {
  it('a ninth distinct key for the same call is present and not recorded', async () => {
    const { store, stored } = setup()
    const call = (key: string) => ({ key, kind: 'call', at: AT, title: 'Weekly sync', meetingKey: 'mk-1' })
    await store.contribute('ada', DAY, { items: [call('conversations:a1')] })
    const eight = await store.contribute('bo', DAY, { items: Array.from({ length: AKA_MAX }, (_, i) => call(`conversations:b${i + 1}`)) })
    expect(eight.results.every((r) => r.status === 'merged')).toBe(true)
    const before = stored()
    const ninth = await store.contribute('bo', DAY, { items: [call('conversations:b9')] })
    expect(ninth.results).toEqual([{ index: 0, key: 'conversations:b9', status: 'present' }])
    expect(stored()).toEqual(before)
    expect(stored().items['conversations:a1'].aka).toHaveLength(AKA_MAX)
    expect((await store.contribute('bo', DAY, { items: [call('conversations:b9')] })).results[0].status).toBe('present')
  })
})
