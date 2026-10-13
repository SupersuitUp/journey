import { describe, expect, it } from 'vitest'
import { FULL_REASON, REMOVED_REASON, contributeTo, emptyDay, findItem, sameCall, wantsMedia } from './day.js'
import { DAY_MAX_ITEMS } from './item-rules.js'
import type { DayRecord, Item, ItemMedia, NewItem } from './types.js'

type M = 'ada' | 'bo'
const DAY = '2026-10-12'
const NOW = '2026-10-12T16:00:00.000Z'
const LATER = '2026-10-12T17:00:00.000Z'
const AT = '2026-10-12T15:00:00.000Z'

const call = (key: string, extra: Partial<NewItem> = {}): NewItem => ({ key, kind: 'call', at: AT, title: 'Weekly sync', meetingKey: 'mk-1', ...extra })
const shipped = (key: string): NewItem => ({ key, kind: 'shipped', at: AT, title: `Released ${key}` })
const RECORDING: ItemMedia = { id: 'upload-video-1', kind: 'video', width: 1920, height: 1080, thumbPath: null, displayPath: null, videoPath: 'p/video/v.mp4', durationSec: 60 }
const start = () => emptyDay<M>(DAY, NOW)
const withRemoved = (rec: DayRecord<M>, key: string): DayRecord<M> =>
  ({ ...rec, items: { ...rec.items, [key]: { ...rec.items[key], removed: { by: 'bo', at: LATER } } } })

describe('a new day', () => {
  it('holds nothing', () => {
    expect(start()).toEqual({ day: DAY, items: {}, createdAt: NOW, updatedAt: NOW })
  })
})

describe('contributeTo', () => {
  it('adds an item under its key, contributed by the member whose machine sent it', () => {
    const step = contributeTo(start(), 'ada', call('conversations:a1', { summary: 'They planned the week.' }), undefined, LATER)
    expect(step.result).toEqual({ key: 'conversations:a1', status: 'added' })
    expect(step.changed).toBe('conversations:a1')
    expect(step.narrowed).toBe(false)
    expect(step.rec.updatedAt).toBe(LATER)
    expect(step.rec.items['conversations:a1']).toEqual({
      key: 'conversations:a1', kind: 'call', at: AT, by: ['ada'], title: 'Weekly sync',
      summaries: { ada: 'They planned the week.' }, meetingKey: 'mk-1', addedAt: LATER,
    })
  })

  it('never edits the record it was given', () => {
    const rec = start()
    contributeTo(rec, 'ada', shipped('shipped:r1'), undefined, LATER)
    expect(rec).toEqual({ day: DAY, items: {}, createdAt: NOW, updatedAt: NOW })
  })

  it('keeps the media it was handed', () => {
    const step = contributeTo(start(), 'ada', call('conversations:a1'), RECORDING, LATER)
    expect(step.rec.items['conversations:a1'].media).toEqual(RECORDING)
  })

  it('is idempotent: the same key again changes nothing and says it is already there', () => {
    const first = contributeTo(start(), 'ada', shipped('shipped:r1'), undefined, NOW)
    const again = contributeTo(first.rec, 'ada', { ...shipped('shipped:r1'), title: 'A different title' }, undefined, LATER)
    expect(again.result).toEqual({ key: 'shipped:r1', status: 'present' })
    expect(again.changed).toBeNull()
    expect(again.rec).toBe(first.rec)
  })

  it('the other machine sending the same key is also already there', () => {
    const first = contributeTo(start(), 'ada', shipped('shipped:r1'), undefined, NOW)
    const other = contributeTo(first.rec, 'bo', shipped('shipped:r1'), undefined, LATER)
    expect(other.result.status).toBe('present')
    expect(other.rec.items['shipped:r1'].by).toEqual(['ada'])
  })

  it('two machines contribute different things to one day', () => {
    const one = contributeTo(start(), 'ada', shipped('shipped:r1'), undefined, NOW)
    const two = contributeTo(one.rec, 'bo', shipped('shipped:r2'), undefined, LATER)
    expect(Object.keys(two.rec.items).sort()).toEqual(['shipped:r1', 'shipped:r2'])
    expect(two.rec.items['shipped:r2'].by).toEqual(['bo'])
  })

  it('a key that reads like a built-in property is an ordinary key', () => {
    const step = contributeTo(start(), 'ada', shipped('constructor'), undefined, NOW)
    expect(step.result.status).toBe('added')
    expect(findItem(step.rec, 'toString')).toBeUndefined()
  })
})

describe('the same call from both machines is one item', () => {
  const adaFirst = () => contributeTo(start(), 'ada', call('conversations:a1', { summary: 'From Ada.' }), undefined, NOW).rec

  it('merges on the meeting key: one item, both contributors, both sets of notes', () => {
    const step = contributeTo(adaFirst(), 'bo', call('conversations:b7', { summary: 'From Bo.' }), undefined, LATER)
    expect(step.result).toEqual({ key: 'conversations:b7', status: 'merged' })
    expect(step.changed).toBe('conversations:a1')
    expect(step.narrowed).toBe(false)
    expect(Object.keys(step.rec.items)).toEqual(['conversations:a1'])
    const item = step.rec.items['conversations:a1']
    expect(item.by).toEqual(['ada', 'bo'])
    expect(item.aka).toEqual(['conversations:b7'])
    expect(item.summaries).toEqual({ ada: 'From Ada.', bo: 'From Bo.' })
    expect(item.addedAt).toBe(NOW)
  })

  it('the second machine sending its own key again is already there', () => {
    const merged = contributeTo(adaFirst(), 'bo', call('conversations:b7'), undefined, LATER).rec
    const again = contributeTo(merged, 'bo', call('conversations:b7'), undefined, LATER)
    expect(again.result).toEqual({ key: 'conversations:b7', status: 'present' })
    expect(again.rec).toBe(merged)
    expect(findItem(merged, 'conversations:b7')?.key).toBe('conversations:a1')
  })

  it('keeps the first title and takes a recording the first machine did not have', () => {
    const bare = contributeTo(start(), 'ada', { key: 'conversations:a1', kind: 'call', at: AT, title: 'Sync', meetingKey: 'mk-1' }, undefined, NOW).rec
    const step = contributeTo(bare, 'bo', call('conversations:b7', { title: 'Weekly sync' }), RECORDING, LATER)
    expect(step.rec.items['conversations:a1'].title).toBe('Sync')
    expect(step.rec.items['conversations:a1'].media).toEqual(RECORDING)
  })

  it('keeps the first recording when both machines sent one', () => {
    const first = contributeTo(start(), 'ada', call('conversations:a1'), RECORDING, NOW).rec
    const step = contributeTo(first, 'bo', call('conversations:b7'), { ...RECORDING, id: 'upload-video-2' }, LATER)
    expect(step.rec.items['conversations:a1'].media?.id).toBe('upload-video-1')
  })

  it('when either machine says others were present, the item loses its recording and summaries', () => {
    const first = contributeTo(start(), 'ada', call('conversations:a1', { summary: 'From Ada.' }), RECORDING, NOW).rec
    const step = contributeTo(first, 'bo', call('conversations:b7', { others: true, line: 'A client joined.' }), undefined, LATER)
    const item = step.rec.items['conversations:a1']
    expect(step.narrowed).toBe(true)
    expect(item.others).toBe(true)
    expect(item.line).toBe('A client joined.')
    expect(item).not.toHaveProperty('media')
    expect(item).not.toHaveProperty('summaries')
  })

  it('a merge onto a day with an account marks it stale, and a narrowing merge also withholds it', () => {
    const written = { ...adaFirst(), account: { text: 'Ada met.', by: 'ada' as const, at: NOW, basedOn: 'x', firstAt: NOW } }
    const plain = contributeTo(written, 'bo', call('conversations:b7', { summary: 'From Bo.' }), undefined, LATER)
    expect(plain.rec.accountStale).toBe(true)
    expect(plain.rec).not.toHaveProperty('accountWithheld')
    const narrow = contributeTo(written, 'bo', call('conversations:b7', { others: true, line: 'A client joined.' }), undefined, LATER)
    expect(narrow.rec).toMatchObject({ accountStale: true, accountWithheld: true })
  })

  it('a present contribute marks nothing, and a merge onto a day with no account marks nothing', () => {
    const written = { ...adaFirst(), account: { text: 'Ada met.', by: 'ada' as const, at: NOW, basedOn: 'x', firstAt: NOW } }
    const again = contributeTo(written, 'ada', call('conversations:a1'), undefined, LATER)
    expect(again.result.status).toBe('present')
    expect(again.rec).not.toHaveProperty('accountStale')
    const bare = contributeTo(adaFirst(), 'bo', call('conversations:b7', { others: true }), undefined, LATER)
    expect(bare.rec).not.toHaveProperty('accountStale')
    expect(bare.rec).not.toHaveProperty('accountWithheld')
  })

  it('a call with no meeting key never merges', () => {
    const first = contributeTo(start(), 'ada', { key: 'conversations:a1', kind: 'call', at: AT, title: 'Sync' }, undefined, NOW).rec
    const step = contributeTo(first, 'bo', { key: 'conversations:b7', kind: 'call', at: AT, title: 'Sync' }, undefined, LATER)
    expect(step.result.status).toBe('added')
    expect(sameCall(first, { key: 'conversations:b7', kind: 'call', at: AT, title: 'Sync' })).toBeUndefined()
  })
})

describe('a removed item is never taken back', () => {
  const removedCall = () => withRemoved(
    contributeTo(contributeTo(start(), 'ada', call('conversations:a1'), undefined, NOW).rec, 'bo', call('conversations:b7'), undefined, NOW).rec,
    'conversations:a1',
  )

  it('its own key is refused, for good', () => {
    const step = contributeTo(removedCall(), 'ada', call('conversations:a1'), undefined, LATER)
    expect(step.result).toEqual({ key: 'conversations:a1', status: 'refused', reason: REMOVED_REASON })
    expect(step.changed).toBeNull()
  })

  it('the other machine key for the same call is refused', () => {
    expect(contributeTo(removedCall(), 'bo', call('conversations:b7'), undefined, LATER).result.status).toBe('refused')
  })

  it('a third key for the same meeting is refused, and is not written down', () => {
    const rec = removedCall()
    const step = contributeTo(rec, 'bo', call('conversations:b99'), undefined, LATER)
    expect(step.result).toEqual({ key: 'conversations:b99', status: 'refused', reason: REMOVED_REASON })
    expect(step.rec).toBe(rec)
  })
})

describe('what the others-present rule forbids never comes back through a removed call', () => {
  const written = (rec: DayRecord<M>): DayRecord<M> => ({ ...rec, account: { text: 'Ada met.', by: 'ada', at: NOW, basedOn: 'x', firstAt: NOW } })
  const full = () => contributeTo(start(), 'ada', call('conversations:a1', { summary: 'From Ada.' }), RECORDING, NOW).rec

  it('the other machine saying others were present is still refused, and the removed call takes the narrowing', () => {
    const rec = withRemoved(full(), 'conversations:a1')
    const step = contributeTo(rec, 'bo', call('conversations:b7', { others: true, line: 'A client joined.' }), undefined, LATER)
    expect(step.result).toEqual({ key: 'conversations:b7', status: 'refused', reason: REMOVED_REASON })
    expect(step.changed).toBeNull()
    expect(step.narrowed).toBe(true)
    const item = step.rec.items['conversations:a1']
    expect(item).toMatchObject({ title: 'Weekly sync', others: true, line: 'A client joined.', removed: { by: 'bo', at: LATER }, by: ['ada'], owesForget: LATER })
    expect(item).not.toHaveProperty('summaries')
    expect(item).not.toHaveProperty('media')
    expect(item).not.toHaveProperty('aka')
    expect(step.rec).not.toHaveProperty('accountOwesForget')
    expect(JSON.stringify(step.rec)).not.toContain('From Ada.')
    expect(JSON.stringify(step.rec)).not.toContain('p/video/v.mp4')
  })

  it('on a day that was written up, the account owes a forget too', () => {
    const step = contributeTo(written(withRemoved(full(), 'conversations:a1')), 'bo', call('conversations:b7', { others: true }), undefined, LATER)
    expect(step.rec.accountOwesForget).toBe(LATER)
  })

  it('the other order: a removed call with others present is not widened by the full one', () => {
    const narrow = withRemoved(contributeTo(start(), 'bo', call('conversations:b7', { others: true, line: 'A client joined.' }), undefined, NOW).rec, 'conversations:b7')
    const step = contributeTo(narrow, 'ada', call('conversations:a1', { summary: 'From Ada.' }), RECORDING, LATER)
    expect(step.result.status).toBe('refused')
    expect(step.rec).toBe(narrow)
    expect(step.narrowed).toBe(false)
  })

  it('a refused twin that says nothing of others changes nothing', () => {
    const rec = withRemoved(full(), 'conversations:a1')
    const step = contributeTo(rec, 'bo', call('conversations:b7', { summary: 'From Bo.' }), undefined, LATER)
    expect(step.rec).toBe(rec)
    expect(step.narrowed).toBe(false)
  })
})

describe('a narrowing merge owes search a forget', () => {
  const full = () => contributeTo(start(), 'ada', call('conversations:a1', { summary: 'From Ada.' }), RECORDING, NOW).rec

  it('marks the item, and the account when the day had one', () => {
    const bare = contributeTo(full(), 'bo', call('conversations:b7', { others: true }), undefined, LATER).rec
    expect(bare.items['conversations:a1'].owesForget).toBe(LATER)
    expect(bare).not.toHaveProperty('accountOwesForget')
    const written = { ...full(), account: { text: 'Ada met.', by: 'ada' as const, at: NOW, basedOn: 'x', firstAt: NOW } }
    const narrow = contributeTo(written, 'bo', call('conversations:b7', { others: true }), undefined, LATER).rec
    expect(narrow.items['conversations:a1'].owesForget).toBe(LATER)
    expect(narrow.accountOwesForget).toBe(LATER)
  })

  it('a merge that strips nothing owes nothing', () => {
    const plain = contributeTo(full(), 'bo', call('conversations:b7', { summary: 'From Bo.' }), undefined, LATER).rec
    expect(plain.items['conversations:a1']).not.toHaveProperty('owesForget')
    const already = contributeTo(start(), 'ada', call('conversations:a1', { others: true }), undefined, NOW).rec
    const again = contributeTo(already, 'bo', call('conversations:b7', { others: true }), undefined, LATER).rec
    expect(again.items['conversations:a1']).not.toHaveProperty('owesForget')
  })
})

describe('a day has a size', () => {
  it('reports an item past the limit as invalid: sending it again as it is would change nothing', () => {
    const items: Record<string, Item<M>> = {}
    for (let i = 0; i < DAY_MAX_ITEMS; i++) items[`shipped:r${i}`] = { key: `shipped:r${i}`, kind: 'shipped', at: AT, by: ['ada'], title: 'x', addedAt: NOW }
    const step = contributeTo({ ...start(), items }, 'ada', shipped('shipped:one-more'), undefined, LATER)
    expect(step.result).toEqual({ key: 'shipped:one-more', status: 'invalid', reason: FULL_REASON })
    expect(step.changed).toBeNull()
  })
})

describe('wantsMedia: whether an upload should be filed before the day is written', () => {
  const VIDEO = { uploadId: 'upload-video-1', kind: 'video' as const, durationSec: 60, width: 1920, height: 1080 }

  it('yes for an item the day has never seen', () => {
    expect(wantsMedia(start(), call('conversations:a1', { media: VIDEO }))).toBe(true)
  })

  it('no without media, and no for a key the day already has', () => {
    expect(wantsMedia(start(), call('conversations:a1'))).toBe(false)
    const rec = contributeTo(start(), 'ada', call('conversations:a1'), undefined, NOW).rec
    expect(wantsMedia(rec, call('conversations:a1', { media: VIDEO }))).toBe(false)
  })

  it('for the same call from the other machine: yes only when the item has no recording yet', () => {
    const bare = contributeTo(start(), 'ada', call('conversations:a1'), undefined, NOW).rec
    const full = contributeTo(start(), 'ada', call('conversations:a1'), RECORDING, NOW).rec
    expect(wantsMedia(bare, call('conversations:b7', { media: VIDEO }))).toBe(true)
    expect(wantsMedia(full, call('conversations:b7', { media: VIDEO }))).toBe(false)
    expect(wantsMedia(withRemoved(bare, 'conversations:a1'), call('conversations:b7', { media: VIDEO }))).toBe(false)
  })
})
