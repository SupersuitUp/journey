import { describe, expect, it } from 'vitest'
import { RuleError } from './errors.js'
import { contributeTo, emptyDay } from './day.js'
import { dayHash } from './day-hash.js'
import { removeFrom, removedOf, restoreIn, visibleOf } from './removal.js'
import type { DayRecord, ItemMedia, NewItem } from './types.js'

type M = 'ada' | 'bo'
const DAY = '2026-10-12'
const NOW = '2026-10-12T16:00:00.000Z'
const LATER = '2026-10-12T17:00:00.000Z'
const LATEST = '2026-10-12T18:00:00.000Z'
const PHOTO: ItemMedia = { id: 'upload-photo-1', kind: 'photo', width: 3024, height: 4032, thumbPath: 'p/thumb/a.jpg', displayPath: 'p/display/a.jpg' }

const add = (rec: DayRecord<M>, m: M, item: NewItem, media?: ItemMedia) => contributeTo(rec, m, item, media, NOW).rec
function day(): DayRecord<M> {
  let rec = emptyDay<M>(DAY, NOW)
  rec = add(rec, 'ada', { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', title: 'Released 0.1.0' })
  rec = add(rec, 'ada', { key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Weekly sync', meetingKey: 'mk-1' })
  rec = add(rec, 'bo', { key: 'conversations:b7', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Weekly sync', meetingKey: 'mk-1' })
  rec = add(rec, 'ada', { key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:20:00.000Z', media: { uploadId: 'upload-photo-1', kind: 'photo' } }, PHOTO)
  return rec
}
const withAccount = (rec: DayRecord<M>): DayRecord<M> =>
  ({ ...rec, account: { text: 'They shipped.', by: 'ada', at: NOW, basedOn: dayHash(rec.items), firstAt: NOW } })
const notFound = (fn: () => unknown) => {
  try { fn() } catch (err) {
    expect(err).toBeInstanceOf(RuleError)
    expect((err as RuleError).status).toBe(404)
    return
  }
  throw new Error('expected a refusal')
}

describe('visibleOf', () => {
  it('lists what is on the day, oldest first', () => {
    expect(visibleOf(day()).map((i) => i.key)).toEqual(['conversations:a1', 'camera-roll:p1', 'shipped:r1'])
  })

  it('breaks a tie in time by key, so the order never shuffles', () => {
    let rec = emptyDay<M>(DAY, NOW)
    rec = add(rec, 'ada', { key: 'shipped:b', kind: 'shipped', at: '2026-10-12T15:00:00.000Z', title: 'b' })
    rec = add(rec, 'ada', { key: 'shipped:a', kind: 'shipped', at: '2026-10-12T15:00:00.000Z', title: 'a' })
    expect(visibleOf(rec).map((i) => i.key)).toEqual(['shipped:a', 'shipped:b'])
  })
})

describe('removeFrom', () => {
  it('hides an item and deletes nothing', () => {
    const out = removeFrom(day(), 'bo', 'camera-roll:p1', LATER)
    expect(out.changed).toBe(true)
    expect(out.key).toBe('camera-roll:p1')
    expect(out.rec.items['camera-roll:p1']).toMatchObject({ key: 'camera-roll:p1', media: PHOTO, removed: { by: 'bo', at: LATER } })
    expect(visibleOf(out.rec).map((i) => i.key)).toEqual(['conversations:a1', 'shipped:r1'])
    expect(out.rec.updatedAt).toBe(LATER)
  })

  it('either member removes any item, their own or the other one', () => {
    expect(removeFrom(day(), 'ada', 'camera-roll:p1', LATER).rec.items['camera-roll:p1'].removed?.by).toBe('ada')
    expect(removeFrom(day(), 'bo', 'shipped:r1', LATER).rec.items['shipped:r1'].removed?.by).toBe('bo')
  })

  it('removes a merged call under either machine key', () => {
    const out = removeFrom(day(), 'ada', 'conversations:b7', LATER)
    expect(out.key).toBe('conversations:a1')
    expect(out.rec.items['conversations:a1'].removed).toEqual({ by: 'ada', at: LATER })
  })

  it('removing twice keeps the first removal', () => {
    const once = removeFrom(day(), 'bo', 'shipped:r1', LATER)
    const twice = removeFrom(once.rec, 'ada', 'shipped:r1', LATEST)
    expect(twice.changed).toBe(false)
    expect(twice.rec).toBe(once.rec)
    expect(twice.rec.items['shipped:r1'].removed).toEqual({ by: 'bo', at: LATER })
  })

  it('refuses a key the day does not hold', () => {
    notFound(() => removeFrom(day(), 'bo', 'shipped:nope', LATER))
  })

  it('marks the item as owing a forget, and the account too when the day had one', () => {
    const bare = removeFrom(day(), 'bo', 'shipped:r1', LATER).rec
    expect(bare.items['shipped:r1'].owesForget).toBe(LATER)
    expect(bare).not.toHaveProperty('accountOwesForget')
    expect(bare.items['camera-roll:p1']).not.toHaveProperty('owesForget')
    const written = removeFrom(withAccount(day()), 'bo', 'shipped:r1', LATER).rec
    expect(written.items['shipped:r1'].owesForget).toBe(LATER)
    expect(written.accountOwesForget).toBe(LATER)
  })

  it('marks a written account stale and withholds it, since it may tell of what was removed', () => {
    const out = removeFrom(withAccount(day()), 'bo', 'shipped:r1', LATER)
    expect(out.hadAccount).toBe(true)
    expect(out.rec.accountStale).toBe(true)
    expect(out.rec.accountWithheld).toBe(true)
    expect(out.rec.account?.text).toBe('They shipped.')
  })

  it('sets no account marks on a day nobody has written up', () => {
    const out = removeFrom(day(), 'bo', 'shipped:r1', LATER)
    expect(out.hadAccount).toBe(false)
    expect(out.rec).not.toHaveProperty('accountStale')
    expect(out.rec).not.toHaveProperty('accountWithheld')
  })

  it('a removed key is refused when a machine sends it again', () => {
    const out = removeFrom(day(), 'bo', 'shipped:r1', LATER)
    expect(contributeTo(out.rec, 'ada', { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', title: 'Released 0.1.0' }, undefined, LATEST).result.status).toBe('refused')
  })
})

describe('removedOf', () => {
  it('lists what was removed, by whom and when, newest first, with a title and a kind and never the media', () => {
    let rec = removeFrom(day(), 'bo', 'shipped:r1', LATER).rec
    rec = removeFrom(rec, 'ada', 'camera-roll:p1', LATEST).rec
    expect(removedOf(rec)).toEqual([
      { key: 'camera-roll:p1', kind: 'photo', by: 'ada', at: LATEST },
      { key: 'shipped:r1', kind: 'shipped', title: 'Released 0.1.0', by: 'bo', at: LATER },
    ])
    expect(JSON.stringify(removedOf(rec))).not.toContain('p/thumb')
  })

  it('is empty when nothing was', () => {
    expect(removedOf(day())).toEqual([])
  })
})

describe('restoreIn', () => {
  it('puts a removed item back as it was', () => {
    const before = day()
    const removed = removeFrom(before, 'bo', 'camera-roll:p1', LATER).rec
    const out = restoreIn(removed, 'camera-roll:p1', LATEST)
    expect(out.changed).toBe(true)
    // As it was, and still marked: search was told to forget it and has not confirmed that yet.
    expect(out.rec.items['camera-roll:p1']).toEqual({ ...before.items['camera-roll:p1'], owesForget: LATER })
    expect(out.rec.items['camera-roll:p1']).not.toHaveProperty('removed')
    expect(dayHash(out.rec.items)).toBe(dayHash(before.items))
  })

  it('a restored key is taken again as already there', () => {
    const out = restoreIn(removeFrom(day(), 'bo', 'shipped:r1', LATER).rec, 'shipped:r1', LATEST)
    expect(contributeTo(out.rec, 'ada', { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', title: 'Released 0.1.0' }, undefined, LATEST).result.status).toBe('present')
  })

  it('marks a written account stale, and leaves a withheld one withheld', () => {
    const removed = removeFrom(withAccount(day()), 'bo', 'shipped:r1', LATER).rec
    const out = restoreIn(removed, 'shipped:r1', LATEST)
    expect(out.rec.accountStale).toBe(true)
    expect(out.rec.accountWithheld).toBe(true)
  })

  it('restoring what is not removed changes nothing, and an unknown key is refused', () => {
    const rec = day()
    const out = restoreIn(rec, 'shipped:r1', LATER)
    expect(out.changed).toBe(false)
    expect(out.rec).toBe(rec)
    notFound(() => restoreIn(rec, 'shipped:nope', LATER))
  })
})
