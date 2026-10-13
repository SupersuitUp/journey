// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { RuleError } from '../errors.js'
import { dayHash } from '../day-hash.js'
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
      results: [{ key: 'conversations:a1', status: 'added' }, { key: 'messages:t1', status: 'added' }, { key: 'shipped:r1', status: 'added' }],
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
    expect(again.results).toEqual([{ key: 'camera-roll:p1', status: 'present' }, { key: 'shipped:r1', status: 'present' }])
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
    expect(answer.results).toEqual([{ key: 'conversations:b7', status: 'merged' }])
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
      { key: 'shipped:r1', status: 'refused', reason: 'removed by a member' },
      { key: 'messages:t1', status: 'added' },
      { key: 'camera-roll:p1', status: 'refused', reason: 'removed by a member' },
    ])
    expect(answer.refused).toEqual(['shipped:r1', 'camera-roll:p1'])
    expect(host.media.filePhoto).toHaveBeenCalledTimes(1)
  })

  it('reports an item it cannot keep and still lands the rest', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [{ key: 'messages:t9', kind: 'text', at: at('11:00') }, SHIPPED] })
    expect(answer.results).toEqual([{ key: 'messages:t9', status: 'failed', reason: 'a text needs words' }, { key: 'shipped:r1', status: 'added' }])
    expect(Object.keys(stored().items)).toEqual(['shipped:r1'])
    expect(answer.refused).toEqual([])
  })

  it('refuses the whole call for a day or a list it cannot read, and writes nothing', async () => {
    const { store, f } = setup()
    await expect(store.contribute('ada', '2026-13-01', { items: [SHIPPED] })).rejects.toMatchObject({ status: 400 })
    await expect(store.contribute('ada', DAY, { items: [] })).rejects.toBeInstanceOf(RuleError)
    await expect(store.contribute('ada', DAY, { items: [{ kind: 'text', at: at('11:00'), words: 'no key' }] })).rejects.toMatchObject({ status: 400 })
    expect(f.all('journey')).toEqual({})
  })

  it('an item sent to the wrong day is reported, since its time does not fall on it', async () => {
    const { store } = setup()
    const answer = await store.contribute('ada', '2026-10-11', { items: [SHIPPED] })
    expect(answer.results[0]).toMatchObject({ status: 'failed', reason: 'at does not fall on 2026-10-11 in America/Chicago' })
  })

  it('writes whole day documents: keys with dots, slashes and colons stay intact at the top level of items', async () => {
    const { store, f } = setup()
    const A = 'conversations:/notes/2026-10-12-sync.v2.md'
    const B = 'shipped:repo/v1.2.3'
    const answer = await store.contribute('ada', DAY, { items: [
      { key: A, kind: 'shipped', at: at('12:00'), title: 'The sync notes' },
      { key: B, kind: 'shipped', at: at('13:00'), title: 'The release' },
    ] })
    expect(answer.results).toEqual([{ key: A, status: 'added' }, { key: B, status: 'added' }])
    const items = (f.raw('journey', DAY) as unknown as DayRecord<M>).items
    expect(Object.keys(items).sort()).toEqual([A, B].sort())
    expect(items[A].title).toBe('The sync notes')
    expect(items[B].title).toBe('The release')
    const again = await store.contribute('ada', DAY, { items: [{ key: A, kind: 'shipped', at: at('12:00'), title: 'The sync notes' }] })
    expect(again.results).toEqual([{ key: A, status: 'present' }])
  })

  it('a key that is an Object.prototype property name is an ordinary key', async () => {
    const { store, stored } = setup()
    const answer = await store.contribute('ada', DAY, { items: [
      { key: 'constructor', kind: 'shipped', at: at('12:00'), title: 'One' },
      { key: 'toString', kind: 'shipped', at: at('13:00'), title: 'Two' },
    ] })
    expect(answer.results).toEqual([{ key: 'constructor', status: 'added' }, { key: 'toString', status: 'added' }])
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
    expect(answer.results).toEqual([{ key: 'camera-roll:p1', status: 'failed', reason: 'upload not found or expired' }, { key: 'shipped:r1', status: 'added' }])
    expect(stored().items).not.toHaveProperty('camera-roll:p1')
  })

  it('anything else the pipeline throws is not a refusal, and stops the call', async () => {
    const { store, host, f } = setup()
    vi.mocked(host.media.filePhoto).mockRejectedValueOnce(new Error('storage is down'))
    await expect(store.contribute('ada', DAY, { items: [PHOTO_ITEM, SHIPPED] })).rejects.toThrow('storage is down')
    expect(f.all('journey')).toEqual({})
  })

  it('a resend whose first answer was lost finds its upload already filed and uses it', async () => {
    const { store, stored, host, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'p/original/a.jpg', display: 'p/display/a.jpg', thumb: 'p/thumb/a.jpg' }, ofDay: DAY, ofKey: 'camera-roll:p1', by: 'ada', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results).toEqual([{ key: 'camera-roll:p1', status: 'added' }])
    expect(host.media.filePhoto).not.toHaveBeenCalled()
    expect(stored().items['camera-roll:p1'].media).toMatchObject({ id: 'upload-photo-1', width: 10, thumbPath: 'p/thumb/a.jpg' })
  })

  it('an upload already filed as something else is not taken for this item', async () => {
    const { store, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'o', display: 'd', thumb: 't' }, ofDay: DAY, ofKey: 'camera-roll:other', by: 'ada', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results).toEqual([{ key: 'camera-roll:p1', status: 'failed', reason: 'that upload is already filed as something else' }])
  })

  it('another member upload is not taken either', async () => {
    const { store, f } = setup()
    f.seed('journey_media', { 'upload-photo-1': { kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 10, height: 20, paths: { original: 'o', display: 'd', thumb: 't' }, ofDay: DAY, ofKey: 'camera-roll:p1', by: 'bo', createdAt: '2026-10-12T15:21:00.000Z' } })
    const answer = await store.contribute('ada', DAY, { items: [PHOTO_ITEM] })
    expect(answer.results[0].status).toBe('failed')
  })

  it('files nothing for a call that already has its recording', async () => {
    const { store, host } = setup()
    const recorded = { ...CALL, media: { uploadId: 'upload-video-1', kind: 'video', durationSec: 60, width: 1280, height: 720 } }
    await store.contribute('ada', DAY, { items: [recorded] })
    await store.contribute('bo', DAY, { items: [{ ...recorded, key: 'conversations:b7', media: { ...recorded.media, uploadId: 'upload-video-2' } }] })
    expect(host.media.fileVideo).toHaveBeenCalledTimes(1)
  })
})
