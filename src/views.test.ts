import { describe, expect, it } from 'vitest'
import { setAccountOn } from './account-rules.js'
import { contributeTo, emptyDay } from './day.js'
import { dayHash } from './day-hash.js'
import { removeFrom } from './removal.js'
import { GROUP_ORDER, agentDayOf, dayRow, dayView, itemView, mediaView, searchDayOf } from './views.js'
import type { DayRecord, ItemMedia, NewItem } from './types.js'

type M = 'ada' | 'bo'
const DAY = '2026-10-12'
const NOW = '2026-10-12T16:00:00.000Z'
const LATER = '2026-10-13T09:00:00.000Z'
const TEXT = 'Ada and Bo planned the week.\n\nThen they shipped.'
const ZONE = 'America/Chicago'
const sign = async (path: string) => `signed:${path}`
const photo = (n: number): ItemMedia => ({ id: `upload-photo-${n}`, kind: 'photo', width: 3024, height: 4032, thumbPath: `p/thumb/${n}.jpg`, displayPath: `p/display/${n}.jpg` })
const CLIP: ItemMedia = { id: 'upload-video-1', kind: 'video', width: 1920, height: 1080, thumbPath: 'p/poster/v.jpg', displayPath: 'p/poster/v.jpg', videoPath: 'p/video/v.mp4', durationSec: 62.5 }

function day(): DayRecord<M> {
  let rec = emptyDay<M>(DAY, NOW)
  const add = (m: M, item: NewItem, media?: ItemMedia) => { rec = contributeTo(rec, m, item, media, NOW).rec }
  add('ada', { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', title: 'Released 0.1.0' })
  add('bo', { key: 'messages:t1', kind: 'text', at: '2026-10-12T16:30:00.000Z', words: 'Shipping it today.' })
  add('ada', { key: 'camera-roll:v1', kind: 'video', at: '2026-10-12T15:40:00.000Z', media: { uploadId: 'upload-video-1', kind: 'video', durationSec: 62.5, width: 1920, height: 1080 } }, CLIP)
  add('bo', { key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:20:00.000Z', title: 'The whiteboard', media: { uploadId: 'upload-photo-1', kind: 'photo' } }, photo(1))
  add('ada', { key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1' })
  add('bo', { key: 'conversations:b7', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Weekly sync', summary: 'From Bo.', meetingKey: 'mk-1' })
  add('ada', { key: 'conversations:a2', kind: 'call', at: '2026-10-12T18:00:00.000Z', title: 'Client call', line: 'Walked through the install.', others: true })
  return rec
}
const written = (rec: DayRecord<M>) => setAccountOn(rec, 'ada', TEXT, dayHash(rec.items), LATER).rec

describe('mediaView and itemView', () => {
  it('signs a photo thumbnail and display image', async () => {
    expect(await mediaView(photo(1), sign)).toEqual({ kind: 'photo', width: 3024, height: 4032, thumbUrl: 'signed:p/thumb/1.jpg', displayUrl: 'signed:p/display/1.jpg' })
  })

  it('signs a video file too, and says how long it is', async () => {
    expect(await mediaView(CLIP, sign)).toEqual({
      kind: 'video', width: 1920, height: 1080, thumbUrl: 'signed:p/poster/v.jpg', displayUrl: 'signed:p/poster/v.jpg', videoUrl: 'signed:p/video/v.mp4', durationSec: 62.5,
    })
  })

  it('a video with no poster has no image to show', async () => {
    const bare = await mediaView({ ...CLIP, thumbPath: null, displayPath: null }, sign)
    expect(bare.thumbUrl).toBeNull()
    expect(bare.displayUrl).toBeNull()
  })

  it('a call shows each contributor notes beside whose machine they came from', async () => {
    const view = await itemView(day().items['conversations:a1'], sign)
    expect(view).toEqual({
      key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', by: ['ada', 'bo'], title: 'Weekly sync',
      summaries: [{ by: 'ada', text: 'From Ada.' }, { by: 'bo', text: 'From Bo.' }],
    })
  })

  it('a text carries who wrote it to the page, to the agent and to search', async () => {
    const rec = contributeTo(emptyDay<M>(DAY, NOW), 'ada', { key: 'messages:t9', kind: 'text', at: '2026-10-12T16:30:00.000Z', words: 'It is live.' }, undefined, NOW, 'bo').rec
    expect((await itemView(rec.items['messages:t9'], sign)).from).toBe('bo')
    expect(agentDayOf(DAY, rec, ZONE).items[0]).toMatchObject({ by: ['ada'], from: 'bo' })
    expect(searchDayOf(rec)!.items[0]).toMatchObject({ by: ['ada'], from: 'bo' })
    expect((await itemView(day().items['messages:t1'], sign)).from).toBeUndefined()
  })

  it('a call with other people present shows its title and its one line', async () => {
    const view = await itemView(day().items['conversations:a2'], sign)
    expect(view).toEqual({ key: 'conversations:a2', kind: 'call', at: '2026-10-12T18:00:00.000Z', by: ['ada'], title: 'Client call', line: 'Walked through the install.', summaries: [], others: true })
  })
})

describe('dayView: the day page', () => {
  it('groups in the order calls, photos and video, texts, shipped, each oldest first', async () => {
    const view = await dayView(day(), sign)
    expect(GROUP_ORDER.map((g) => g.name)).toEqual(['calls', 'media', 'texts', 'shipped'])
    expect(view.groups.map((g) => [g.name, g.items.map((i) => i.key)])).toEqual([
      ['calls', ['conversations:a1', 'conversations:a2']],
      ['media', ['camera-roll:p1', 'camera-roll:v1']],
      ['texts', ['messages:t1']],
      ['shipped', ['shipped:r1']],
    ])
    expect(view.groups[1].items[0].by).toEqual(['bo'])
    expect(view.groups[1].items[0].media?.displayUrl).toBe('signed:p/display/1.jpg')
  })

  it('has every group even when one is empty', async () => {
    const rec = contributeTo(emptyDay<M>(DAY, NOW), 'ada', { key: 'shipped:r1', kind: 'shipped', at: NOW, title: 'Released' }, undefined, NOW).rec
    const view = await dayView(rec, sign)
    expect(view.groups.map((g) => g.items.length)).toEqual([0, 0, 0, 1])
  })

  it('shows the account once written, and no account before', async () => {
    expect((await dayView(day(), sign)).account).toBeNull()
    expect((await dayView(day(), sign)).accountPending).toBe(false)
    expect((await dayView(written(day()), sign)).account).toEqual({ text: TEXT, by: 'ada', at: LATER })
  })

  it('leaves a removed item out of every group, and counts it', async () => {
    const rec = removeFrom(day(), 'bo', 'camera-roll:p1', LATER).rec
    const view = await dayView(rec, sign)
    expect(view.groups[1].items.map((i) => i.key)).toEqual(['camera-roll:v1'])
    expect(view.removedCount).toBe(1)
    expect(JSON.stringify(view)).not.toContain('p/display/1.jpg')
  })

  it('withholds an account that was written before an item was removed', async () => {
    const view = await dayView(removeFrom(written(day()), 'bo', 'messages:t1', LATER).rec, sign)
    expect(view.account).toBeNull()
    expect(view.accountPending).toBe(true)
  })
})

describe('dayRow: one day in the list', () => {
  it('carries the date, the first line of the account, up to four thumbnails and the count', async () => {
    let rec = written(day())
    for (const n of [2, 3, 4, 5]) {
      rec = contributeTo(rec, 'ada', { key: `camera-roll:p${n}`, kind: 'photo', at: `2026-10-12T15:2${n}:00.000Z`, media: { uploadId: `upload-photo-${n}`, kind: 'photo' } }, photo(n), LATER).rec
    }
    expect(await dayRow(rec, sign)).toEqual({
      day: DAY, firstLine: 'Ada and Bo planned the week.', count: 10,
      thumbs: ['signed:p/thumb/1.jpg', 'signed:p/thumb/2.jpg', 'signed:p/thumb/3.jpg', 'signed:p/thumb/4.jpg'],
    })
  })

  it('has no first line before the day is written up, or while its account is withheld', async () => {
    expect((await dayRow(day(), sign))?.firstLine).toBeNull()
    expect((await dayRow(removeFrom(written(day()), 'bo', 'messages:t1', LATER).rec, sign))?.firstLine).toBeNull()
  })

  it('never shows a removed item thumbnail, and a day with nothing left is no row at all', async () => {
    const rec = removeFrom(day(), 'bo', 'camera-roll:p1', LATER).rec
    expect((await dayRow(rec, sign))?.thumbs).toEqual(['signed:p/poster/v.jpg'])
    let gone = contributeTo(emptyDay<M>(DAY, NOW), 'ada', { key: 'shipped:r1', kind: 'shipped', at: NOW, title: 'Released' }, undefined, NOW).rec
    gone = removeFrom(gone, 'bo', 'shipped:r1', LATER).rec
    expect(await dayRow(gone, sign)).toBeNull()
  })
})

describe('agentDayOf: what the session that writes the account reads', () => {
  it('lists visible items with their words, their contributors and whether they carry media, never a URL or a path', () => {
    const rec = day()
    const out = agentDayOf(DAY, rec, ZONE)
    expect(out.day).toBe(DAY)
    expect(out.hash).toBe(dayHash(rec.items))
    expect(out.account).toBeNull()
    expect(out.accountStale).toBe(false)
    expect(out.items.map((i) => i.key)).toEqual(['conversations:a1', 'camera-roll:p1', 'camera-roll:v1', 'messages:t1', 'conversations:a2', 'shipped:r1'])
    expect(out.items[0]).toEqual({
      key: 'conversations:a1', aka: ['conversations:b7'], kind: 'call', at: '2026-10-12T15:00:00.000Z', by: ['ada', 'bo'], title: 'Weekly sync',
      summaries: { ada: 'From Ada.', bo: 'From Bo.' }, meetingKey: 'mk-1', hasMedia: false,
    })
    expect(out.items[1]).toEqual({ key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:20:00.000Z', by: ['bo'], title: 'The whiteboard', hasMedia: true, mediaKind: 'photo' })
    expect(out.items[3].words).toBe('Shipping it today.')
    expect(out.items[4]).toMatchObject({ others: true, line: 'Walked through the install.', hasMedia: false })
    expect(JSON.stringify(out)).not.toMatch(/signed:|p\/thumb|p\/video/)
  })

  it('carries the account and what it was written from, and says when it is stale', () => {
    const rec = written(day())
    expect(agentDayOf(DAY, rec, ZONE).account).toEqual({ text: TEXT, by: 'ada', at: LATER, basedOn: dayHash(rec.items) })
    expect(agentDayOf(DAY, rec, ZONE).accountStale).toBe(false)
    const grown = contributeTo(rec, 'bo', { key: 'shipped:r2', kind: 'shipped', at: '2026-10-12T22:00:00.000Z', title: 'Released 0.1.1' }, undefined, LATER).rec
    expect(agentDayOf(DAY, grown, ZONE).accountStale).toBe(true)
    expect(agentDayOf(DAY, grown, ZONE).account?.text).toBe(TEXT)
  })

  it('leaves a removed item out, and holds back an account that may tell of it', () => {
    const rec = removeFrom(written(day()), 'bo', 'messages:t1', LATER).rec
    const out = agentDayOf(DAY, rec, ZONE)
    expect(out.items.map((i) => i.key)).not.toContain('messages:t1')
    expect(out.account).toBeNull()
    expect(out.accountStale).toBe(true)
    expect(out.hash).toBe(dayHash(rec.items))
  })

  it('a day nobody has contributed to reads as an empty day', () => {
    expect(agentDayOf(DAY, null, ZONE)).toEqual({ day: DAY, timeZone: ZONE, hash: dayHash({}), account: null, accountStale: false, items: [] })
  })
})

describe('agentDayOf carries the zone the day is counted in', () => {
  it('so the session that writes the account knows which day an instant falls on', () => {
    expect(agentDayOf(DAY, day(), 'Asia/Tokyo').timeZone).toBe('Asia/Tokyo')
  })
})

describe('searchDayOf: the one thing a search index may hold of a day', () => {
  it('is null for no day', () => {
    expect(searchDayOf(null)).toBeNull()
  })

  it('lists every visible item with its words and its thumbnail path, oldest first, and the account once written', () => {
    const out = searchDayOf(written(day()))!
    expect(out.day).toBe(DAY)
    expect(out.account).toBe(TEXT)
    expect(out.items).toEqual([
      { key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', by: ['ada', 'bo'], title: 'Weekly sync', summaries: { ada: 'From Ada.', bo: 'From Bo.' } },
      { key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:20:00.000Z', by: ['bo'], title: 'The whiteboard', thumbPath: 'p/thumb/1.jpg' },
      { key: 'camera-roll:v1', kind: 'video', at: '2026-10-12T15:40:00.000Z', by: ['ada'], thumbPath: 'p/poster/v.jpg' },
      { key: 'messages:t1', kind: 'text', at: '2026-10-12T16:30:00.000Z', by: ['bo'], words: 'Shipping it today.' },
      { key: 'conversations:a2', kind: 'call', at: '2026-10-12T18:00:00.000Z', by: ['ada'], title: 'Client call', line: 'Walked through the install.' },
      { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', by: ['ada'], title: 'Released 0.1.0' },
    ])
  })

  it('has no account before one is written', () => {
    expect(searchDayOf(day())).not.toHaveProperty('account')
  })

  it('leaves out a removed item, and the account withheld with it', () => {
    const out = searchDayOf(removeFrom(written(day()), 'bo', 'messages:t1', LATER).rec)!
    expect(out.items.map((i) => i.key)).not.toContain('messages:t1')
    expect(out).not.toHaveProperty('account')
    expect(JSON.stringify(out)).not.toContain('Shipping it today.')
  })

  it('leaves out an item that still owes a forget, visible or not, and an account that does', () => {
    const rec = written(day())
    const owing: DayRecord<M> = { ...rec, items: { ...rec.items, 'messages:t1': { ...rec.items['messages:t1'], owesForget: LATER } }, accountOwesForget: LATER }
    const out = searchDayOf(owing)!
    expect(out.items.map((i) => i.key)).not.toContain('messages:t1')
    expect(out.items).toHaveLength(5)
    expect(out).not.toHaveProperty('account')
  })
})

describe('a scene and a transcript travel with the item', () => {
  const withScene = () => contributeTo(emptyDay<M>(DAY, NOW), 'ada', {
    key: 'camera-roll:v2', kind: 'video', at: '2026-10-12T15:40:00.000Z', scene: 'A desk by a window.', transcript: 'So the plan is this.',
    media: { uploadId: 'upload-video-1', kind: 'video', durationSec: 62.5, width: 1920, height: 1080 },
  }, CLIP, NOW).rec

  it('a member sees both, and an item without them shows neither', async () => {
    const rec = withScene()
    expect(await itemView(rec.items['camera-roll:v2'], sign)).toMatchObject({ scene: 'A desk by a window.', transcript: 'So the plan is this.' })
    expect(await itemView(day().items['camera-roll:p1'], sign)).not.toHaveProperty('scene')
  })

  it('the writer of the account and the search index read both', () => {
    const rec = withScene()
    expect(agentDayOf(DAY, rec, ZONE).items[0]).toMatchObject({ scene: 'A desk by a window.', transcript: 'So the plan is this.' })
    expect(searchDayOf(rec)!.items[0]).toMatchObject({ scene: 'A desk by a window.', transcript: 'So the plan is this.' })
  })
})
