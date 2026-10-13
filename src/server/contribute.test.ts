// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RuleError } from '../errors.js'
import { dayHash } from '../day-hash.js'
import { accountStale } from '../account-rules.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const DAY = '2026-10-12'
const at = (hhmm: string) => `2026-10-12T${hhmm}:00-05:00`
const CALL = { key: 'conversations:a1', kind: 'call', at: at('10:00'), title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1' }
const PHOTO_ITEM = { key: 'camera-roll:p1', kind: 'photo', at: at('10:20'), media: { uploadId: 'upload-photo-1', kind: 'photo' } }
const VIDEO_ITEM = { key: 'camera-roll:v1', kind: 'video', at: at('10:40'), media: { uploadId: 'upload-video-1', kind: 'video', durationSec: 62.5, width: 1920, height: 1080 } }
const TEXT = { key: 'messages:t1', kind: 'text', at: at('11:30'), words: 'Shipping it today.' }
const SHIPPED = { key: 'shipped:r1', kind: 'shipped', at: at('16:00'), title: 'Released 0.1.0' }

const setup = (opts?: Parameters<typeof fakeHost>[0]) => {
  const h = fakeHost(opts)
  const store = createJourneyStore(h.host)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  return { ...h, store, stored }
}

describe('a host that does not fit is refused when the app starts', () => {
  it('names the zone, the collections and the parts that are missing', () => {
    const { host } = fakeHost()
    expect(() => createJourneyStore({ ...host, timeZone: 'Mars/Olympus' })).toThrow(/not a time zone/)
    expect(() => createJourneyStore({ ...host, mediaCollection: host.collection })).toThrow(/mediaCollection/)
    expect(() => createJourneyStore({ ...host, collection: '' })).toThrow(/collection/)
    expect(() => createJourneyStore({ ...host, announce: {} as never })).toThrow(/announce\.dayWritten/)
    expect(() => createJourneyStore({ ...host, media: { ...host.media, filePhoto: undefined as never } })).toThrow(/media\.filePhoto/)
  })
})

describe('contribute', () => {
  it('files a batch for one day and says what happened to each key', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [CALL, TEXT, SHIPPED] })
    expect(answer).toEqual({
      day: DAY, hash: dayHash(stored().items), refused: [],
      results: [{ index: 0, key: 'conversations:a1', status: 'added' }, { index: 1, key: 'messages:t1', status: 'added' }, { index: 2, key: 'shipped:r1', status: 'added' }],
    })
    expect(stored().day).toBe(DAY)
    expect(stored().items['conversations:a1']).toMatchObject({ by: ['ada'], title: 'Weekly sync', summaries: { ada: 'From Ada.' }, at: '2026-10-12T15:00:00.000Z' })
  })

  it('tells search about each item it wrote, after the write', async () => {
    const { store, calls } = setup()
    await store.contribute('ada', DAY, { items: [TEXT, SHIPPED] })
    expect(calls).toEqual([`index.item:${DAY}:messages:t1`, `index.item:${DAY}:shipped:r1`])
  })

  it('is idempotent: the same batch again changes nothing, files nothing and tells nobody', async () => {
    const { store, stored, host, calls } = setup()
    await store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })
    const before = stored()
    calls.length = 0
    const again = await store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })
    expect(again.results).toEqual([{ index: 0, key: 'camera-roll:p1', status: 'present' }, { index: 1, key: 'shipped:r1', status: 'present' }])
    expect(stored()).toEqual(before)
    expect(host.media.filePhoto).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([])
  })

  it('the same key twice in one call is added once', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [SHIPPED, SHIPPED] })
    expect(answer.results.map((r) => r.status)).toEqual(['added', 'present'])
    expect(Object.keys(stored().items)).toEqual(['shipped:r1'])
  })

  it('two machines contribute to one day', async () => {
    const { store, stored } = setup()
    await store.contribute('ada', DAY, { items: [SHIPPED] })
    await store.contribute('bo', DAY, { items: [TEXT] })
    expect(stored().items['shipped:r1'].by).toEqual(['ada'])
    expect(stored().items['messages:t1'].by).toEqual(['bo'])
  })

  it('the same call from both machines is one item with both contributors', async () => {
    const { store, stored, calls } = setup()
    await store.contribute('ada', DAY, { items: [CALL] })
    const answer = await store.contribute('bo', DAY, { items: [{ ...CALL, key: 'conversations:b7', summary: 'From Bo.' }] })
    expect(answer.results).toEqual([{ index: 0, key: 'conversations:b7', status: 'merged' }])
    expect(Object.keys(stored().items)).toEqual(['conversations:a1'])
    expect(stored().items['conversations:a1']).toMatchObject({ by: ['ada', 'bo'], aka: ['conversations:b7'], summaries: { ada: 'From Ada.', bo: 'From Bo.' } })
    expect(calls).toEqual([`index.item:${DAY}:conversations:a1`, `index.item:${DAY}:conversations:a1`])
    expect(answer.hash).toBe(dayHash(stored().items))
  })

  it('a merge that learns other people were present has search forget the item before it is indexed again', async () => {
    const { store, calls } = setup()
    await store.contribute('ada', DAY, { items: [CALL] })
    calls.length = 0
    await store.contribute('bo', DAY, { items: [{ key: 'conversations:b7', kind: 'call', at: at('10:00'), title: 'Weekly sync', meetingKey: 'mk-1', others: true, line: 'A client joined.' }] })
    expect(calls).toEqual([`forget.item:${DAY}:conversations:a1`, `index.item:${DAY}:conversations:a1`])
  })

  it('names the keys that are refused for good, so the machine never sends them again', async () => {
    const { store, f, stored, host } = setup()
    await store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })
    const rec = stored()
    rec.items['shipped:r1'].removed = { by: 'bo', at: '2026-10-12T22:00:00.000Z' }
    rec.items['camera-roll:p1'].removed = { by: 'bo', at: '2026-10-12T22:00:00.000Z' }
    f.seed('journey', { [DAY]: rec })
    const answer = await store.contribute('ada', DAY, { items: [SHIPPED, TEXT, { ...PHOTO_ITEM, media: { uploadId: 'upload-photo-2', kind: 'photo' } }] })
    expect(answer.results).toEqual([
      { index: 0, key: 'shipped:r1', status: 'refused', reason: 'removed by a member' },
      { index: 1, key: 'messages:t1', status: 'added' },
      { index: 2, key: 'camera-roll:p1', status: 'refused', reason: 'removed by a member' },
    ])
    expect(answer.refused).toEqual(['shipped:r1', 'camera-roll:p1'])
    expect(host.media.filePhoto).toHaveBeenCalledTimes(1)
  })

  it('reports an item it cannot keep and still lands the rest', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [{ key: 'messages:t9', kind: 'text', at: at('11:00') }, SHIPPED] })
    expect(answer.results).toEqual([{ index: 0, key: 'messages:t9', status: 'invalid', reason: 'a text needs words' }, { index: 1, key: 'shipped:r1', status: 'added' }])
    expect(Object.keys(stored().items)).toEqual(['shipped:r1'])
    expect(answer.refused).toEqual([])
  })

  it('refuses the whole call for a day it cannot read, a body with no list, or too many items, and writes nothing', async () => {
    const { store, f } = setup()
    await expect(store.contribute('ada', '2026-13-01', { items: [SHIPPED] })).rejects.toMatchObject({ status: 400 })
    await expect(store.contribute('ada', undefined, { items: [SHIPPED] })).rejects.toMatchObject({ status: 400 })
    await expect(store.contribute('ada', DAY, { items: 'x' })).rejects.toBeInstanceOf(RuleError)
    await expect(store.contribute('ada', DAY, null)).rejects.toMatchObject({ status: 400 })
    const many = Array.from({ length: 61 }, (_, i) => ({ ...SHIPPED, key: `shipped:r${i}` }))
    await expect(store.contribute('ada', DAY, { items: many })).rejects.toMatchObject({ status: 400 })
    expect(f.all('journey')).toEqual({})
  })

  it('an empty list is nothing to do: it answers, and writes nothing', async () => {
    const { store, f } = setup()
    expect(await store.contribute('ada', DAY, { items: [] })).toEqual({ day: DAY, hash: dayHash({}), results: [], refused: [] })
    expect(f.all('journey')).toEqual({})
  })

  it('one bad key never sinks a batch: that item is invalid in its place, and the rest land', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [
      { ...SHIPPED, key: ' padded' },
      { kind: 'text', at: at('11:00'), words: 'no key' },
      { ...SHIPPED, key: 7 },
      null,
      { ...SHIPPED, key: '__name__' },
      { ...SHIPPED, key: 'notes:Réunion du lundi.md' },
      TEXT,
    ] })
    const KEY_WORDS = 'key must be 1 to 300 characters, with no control characters, no space at either end, and not of the form __name__'
    expect(answer.results).toEqual([
      { index: 0, key: ' padded', status: 'invalid', reason: KEY_WORDS },
      { index: 1, key: '', status: 'invalid', reason: KEY_WORDS },
      { index: 2, key: '', status: 'invalid', reason: KEY_WORDS },
      { index: 3, key: '', status: 'invalid', reason: KEY_WORDS },
      { index: 4, key: '__name__', status: 'invalid', reason: KEY_WORDS },
      { index: 5, key: 'notes:Réunion du lundi.md', status: 'added' },
      { index: 6, key: 'messages:t1', status: 'added' },
    ])
    expect(Object.keys(stored().items).sort()).toEqual(['messages:t1', 'notes:Réunion du lundi.md'])
    expect(answer.refused).toEqual([])
  })

  it('every row says where its item stood in the call, so two rows with one key are told apart', async () => {
    const { store } = setup()
    const answer = await store.contribute('ada', DAY, { items: [SHIPPED, { ...SHIPPED, title: undefined }, SHIPPED] })
    expect(answer.results.map((r) => [r.index, r.key, r.status])).toEqual([[0, 'shipped:r1', 'added'], [1, 'shipped:r1', 'invalid'], [2, 'shipped:r1', 'present']])
  })

  it('an item sent to the wrong day is reported, since its time does not fall on it', async () => {
    const { store } = setup()
    const answer = await store.contribute('ada', '2026-10-11', { items: [SHIPPED] })
    expect(answer.results[0]).toMatchObject({ status: 'invalid', reason: 'at does not fall on 2026-10-11 in America/Chicago' })
  })

  it('writes whole day documents: keys with dots, slashes and colons stay intact at the top level of items', async () => {
    const { store, f } = setup()
    const A = 'conversations:/notes/2026-10-12-sync.v2.md'
    const B = 'shipped:repo/v1.2.3'
    const answer = await store.contribute('ada', DAY, { items: [
      { key: A, kind: 'shipped', at: at('12:00'), title: 'The sync notes' },
      { key: B, kind: 'shipped', at: at('13:00'), title: 'The release' },
    ] })
    expect(answer.results).toEqual([{ index: 0, key: A, status: 'added' }, { index: 1, key: B, status: 'added' }])
    const items = (f.raw('journey', DAY) as unknown as DayRecord<M>).items
    expect(Object.keys(items).sort()).toEqual([A, B].sort())
    expect(items[A].title).toBe('The sync notes')
    expect(items[B].title).toBe('The release')
    const again = await store.contribute('ada', DAY, { items: [{ key: A, kind: 'shipped', at: at('12:00'), title: 'The sync notes' }] })
    expect(again.results).toEqual([{ index: 0, key: A, status: 'present' }])
  })

  it('a key that is an Object.prototype property name is an ordinary key', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [
      { key: 'constructor', kind: 'shipped', at: at('12:00'), title: 'One' },
      { key: 'toString', kind: 'shipped', at: at('13:00'), title: 'Two' },
    ] })
    expect(answer.results).toEqual([{ index: 0, key: 'constructor', status: 'added' }, { index: 1, key: 'toString', status: 'added' }])
    expect(Object.keys(stored().items).sort()).toEqual(['constructor', 'toString'])
    expect(stored().items['constructor'].title).toBe('One')
    expect(stored().items['toString'].title).toBe('Two')
  })
})

describe('media goes through the host own pipeline', () => {
  it('files a photo into the media collection under the upload id, and the item keeps where its files are', async () => {
    const { store, stored, host, f } = setup()
    await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(host.media.filePhoto).toHaveBeenCalledWith('ada', 'upload-photo-1', '2026-10-12T10:20:00', expect.objectContaining({ record: expect.any(Function) }))
    expect(f.raw('journey_media', 'upload-photo-1')).toMatchObject({ kind: 'photo', ofDay: DAY, ofKey: 'camera-roll:p1', by: 'ada', paths: { thumb: 'p/thumb/upload-photo-1.jpg' } })
    expect(stored().items['camera-roll:p1'].media).toEqual({
      id: 'upload-photo-1', kind: 'photo', width: 3024, height: 4032, thumbPath: 'p/thumb/upload-photo-1.jpg', displayPath: 'p/display/upload-photo-1.jpg',
    })
  })

  it('files a video with what the machine measured, stamped in the host zone', async () => {
    const { store, stored, host } = setup()
    await store.contribute('ada', DAY, { items: [VIDEO_ITEM] })
    expect(host.media.fileVideo).toHaveBeenCalledWith('ada', 'upload-video-1', { durationSec: 62.5, width: 1920, height: 1080, takenAt: '2026-10-12T10:40:00' }, expect.anything())
    expect(stored().items['camera-roll:v1'].media).toMatchObject({ kind: 'video', videoPath: 'p/video/upload-video-1.mp4', durationSec: 62.5 })
  })

  it('hands the pipeline a record in the media collection whose id is the upload id', async () => {
    const { store, host } = setup()
    await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    const into = vi.mocked(host.media.filePhoto).mock.calls[0][3]
    expect(into.ref.path).toBe('journey_media/upload-photo-1')
  })

  it('a refusal from the pipeline fails that item only, in the pipeline own words', async () => {
    class Refusal extends Error { status = 400 }
    const { store, stored, host } = setup({ isRefusal: (err) => err instanceof Refusal })
    vi.mocked(host.media.filePhoto).mockRejectedValueOnce(new Refusal('upload not found or expired'))
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })
    expect(answer.results).toEqual([{ index: 0, key: 'camera-roll:p1', status: 'invalid', reason: 'upload not found or expired' }, { index: 1, key: 'shipped:r1', status: 'added' }])
    expect(stored().items).not.toHaveProperty('camera-roll:p1')
  })

  it('an upload the pipeline cannot process is invalid in words a person can read, logged, and the rest land', async () => {
    const { store, stored, host } = setup()
    vi.mocked(host.media.filePhoto).mockRejectedValueOnce(new Error('sharp: unsupported image format at /tmp/x'))
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })
    expect(answer.results).toEqual([
      { index: 0, key: 'camera-roll:p1', status: 'invalid', reason: 'that upload could not be read' },
      { index: 1, key: 'shipped:r1', status: 'added' },
    ])
    expect(Object.keys(stored().items)).toEqual(['shipped:r1'])
    expect(host.log).toHaveBeenCalledWith('journey: file media failed', expect.objectContaining({ message: 'sharp: unsupported image format at /tmp/x' }))
    expect(JSON.stringify(answer)).not.toContain('sharp')
  })

  it('the same holds for a video, and for a host that named no refusals of its own', async () => {
    const { store, host } = setup()
    vi.mocked(host.media.fileVideo).mockImplementationOnce(() => { throw new TypeError('ffprobe exited 1') })
    const answer = await store.contribute('ada', DAY, { items: [VIDEO_ITEM, TEXT] })
    expect(answer.results.map((r) => [r.status, r.reason])).toEqual([['invalid', 'that upload could not be read'], ['added', undefined]])
  })

  it('a database that cannot be read is not an unreadable upload: the call fails, to be sent again', async () => {
    const { store, host, f } = setup()
    const db = host.db()
    host.db = () => ({ ...db, collection: (name: string) => (name === 'journey_media' ? { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE') } }) } : db.collection(name)) }) as unknown as typeof db
    await expect(store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })).rejects.toThrow('UNAVAILABLE')
    expect(f.all('journey')).toEqual({})
  })

  it('a resend whose first answer was lost finds its upload already filed and uses it', async () => {
    const { store, stored, host, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'p/original/a.jpg', display: 'p/display/a.jpg', thumb: 'p/thumb/a.jpg' }, ofDay: DAY, ofKey: 'camera-roll:p1', by: 'ada', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results).toEqual([{ index: 0, key: 'camera-roll:p1', status: 'added' }])
    expect(host.media.filePhoto).not.toHaveBeenCalled()
    expect(stored().items['camera-roll:p1'].media).toMatchObject({ id: 'upload-photo-1', width: 10, thumbPath: 'p/thumb/a.jpg' })
  })

  it('an upload already filed as something else is not taken for this item', async () => {
    const { store, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'o', display: 'd', thumb: 't' }, ofDay: DAY, ofKey: 'camera-roll:other', by: 'ada', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results).toEqual([{ index: 0, key: 'camera-roll:p1', status: 'invalid', reason: 'that upload is already filed as something else' }])
  })

  it('another member upload is not taken either', async () => {
    const { store, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'o', display: 'd', thumb: 't' }, ofDay: DAY, ofKey: 'camera-roll:p1', by: 'bo', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results[0].status).toBe('invalid')
  })

  it('files nothing for a call that already has its recording', async () => {
    const { store, host } = setup()
    const recorded = { ...CALL, media: { uploadId: 'upload-video-1', kind: 'video', durationSec: 60, width: 1280, height: 720 } }
    await store.contribute('ada', DAY, { items: [recorded] })
    await store.contribute('bo', DAY, { items: [{ ...recorded, key: 'conversations:b7', media: { ...recorded.media, uploadId: 'upload-video-2' } }] })
    expect(host.media.fileVideo).toHaveBeenCalledTimes(1)
  })
})

// How many times the store's transaction callbacks ran, so a test can tell that two calls really
// did collide and one of them was run again.
function countRuns(h: ReturnType<typeof fakeHost>) {
  const db = h.host.db()
  let runs = 0
  h.host.db = () => ({ ...db, runTransaction: (fn: (tx: unknown) => Promise<unknown>) => db.runTransaction((tx) => { runs++; return fn(tx) }) }) as typeof db
  return () => runs
}

describe('two calls at once', () => {
  it('the same call from both machines at once is one item with both contributors', async () => {
    const h = setup()
    const runs = countRuns(h)
    const [a, b] = await Promise.all([
      h.store.contribute('ada', DAY, { items: [CALL] }),
      h.store.contribute('bo', DAY, { items: [{ ...CALL, key: 'conversations:b7', summary: 'From Bo.' }] }),
    ])
    expect(runs()).toBe(3)
    const item = Object.values(h.stored().items)
    expect(item).toHaveLength(1)
    expect(item[0].by.sort()).toEqual(['ada', 'bo'])
    expect(item[0].summaries).toEqual({ ada: 'From Ada.', bo: 'From Bo.' })
    // Whichever landed second saw the first's item and merged into it.
    expect([a.results[0].status, b.results[0].status].sort()).toEqual(['added', 'merged'])
    // The one that landed second answers with the hash of the finished day.
    expect([a.hash, b.hash]).toContain(dayHash(h.stored().items))
  })

  it('the same key from two machines at once is one item, with no throw', async () => {
    const h = setup()
    const runs = countRuns(h)
    const [a, b] = await Promise.all([
      h.store.contribute('ada', DAY, { items: [SHIPPED] }),
      h.store.contribute('bo', DAY, { items: [SHIPPED] }),
    ])
    expect(runs()).toBe(3)
    expect(Object.keys(h.stored().items)).toEqual(['shipped:r1'])
    expect(h.stored().items['shipped:r1'].by).toHaveLength(1)
    expect([a.results[0].status, b.results[0].status].sort()).toEqual(['added', 'present'])
  })
})

describe('a merge that narrows an item when search cannot forget it', () => {
  const OTHERS = { key: 'conversations:b7', kind: 'call', at: at('10:00'), title: 'Weekly sync', meetingKey: 'mk-1', others: true, line: 'A client joined.' }

  it('does not index the item again, reports it failed, and keeps the merge', async () => {
    const { store, stored, host, calls } = setup()
    await store.contribute('ada', DAY, { items: [CALL, SHIPPED] })
    calls.length = 0
    vi.mocked(host.forget!.item).mockRejectedValueOnce(new Error('index down'))
    const answer = await store.contribute('bo', DAY, { items: [OTHERS, { key: 'messages:t1', kind: 'text', at: at('11:30'), words: 'Hi.' }] })
    expect(answer.results).toEqual([
      { index: 0, key: 'conversations:b7', status: 'failed', reason: 'merged, but search could not be updated' },
      { index: 1, key: 'messages:t1', status: 'added' },
    ])
    expect(stored().items['conversations:a1']).toMatchObject({ others: true, aka: ['conversations:b7'] })
    expect(stored().items['conversations:a1']).not.toHaveProperty('summaries')
    expect(calls).toEqual([`index.item:${DAY}:messages:t1`])
    expect(host.log).toHaveBeenCalledWith('journey: forget item failed', expect.any(Error))
  })
})

describe('a search hook that rejects', () => {
  it('is logged and never becomes an unhandled rejection', async () => {
    const { store, host } = setup()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    vi.mocked(host.index!.item).mockRejectedValueOnce(new Error('index down'))
    await store.contribute('ada', DAY, { items: [SHIPPED] })
    await new Promise((r) => setTimeout(r, 10))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(host.log).toHaveBeenCalledWith('journey: index item failed', expect.any(Error))
  })
})

describe('an account racing a contribution', () => {
  it.each(['account first', 'contribution first'])('is refused or marked stale, never stored as current (%s)', async (order) => {
    const h = setup()
    await h.store.contribute('ada', DAY, { items: [SHIPPED] })
    const basedOn = dayHash(h.stored().items)
    const write = () => h.store.setAccount('ada', DAY, { text: 'Ada shipped it.', basedOn }).then(() => 'stored', (e: RuleError) => e.status)
    const add = () => h.store.contribute('bo', DAY, { items: [TEXT] })
    const started = order === 'account first' ? [write(), add()] : [add(), write()]
    const results = await Promise.all(started)
    const outcome = order === 'account first' ? results[0] : results[1]
    const rec = h.stored()
    expect(rec.items['messages:t1']).toBeDefined()
    if (outcome === 'stored') {
      expect(rec.account?.basedOn).toBe(basedOn)
      expect(rec.account!.basedOn).not.toBe(dayHash(rec.items))
      expect(accountStale(rec)).toBe(true)
    } else {
      expect(outcome).toBe(409)
      expect(rec).not.toHaveProperty('account')
    }
  })
})
