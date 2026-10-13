// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { dayHash } from '../day-hash.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const DAY = '2026-10-12'
const at = (hhmm: string) => `2026-10-12T${hhmm}:00-05:00`
const CALL = { key: 'conversations:a1', kind: 'call', at: at('10:00'), title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1' }
const PHOTO_ITEM = { key: 'camera-roll:p1', kind: 'photo', at: at('10:20'), media: { uploadId: 'upload-photo-1', kind: 'photo' } }
const SHIPPED = { key: 'shipped:r1', kind: 'shipped', at: at('16:00'), title: 'Released 0.1.0' }
const TEXT = 'Ada and Bo planned the week, then shipped.'

async function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  await store.contribute('ada', DAY, { items: [CALL, PHOTO_ITEM, SHIPPED] })
  await store.contribute('bo', DAY, { items: [{ ...CALL, key: 'conversations:b7', summary: 'From Bo.' }] })
  h.calls.length = 0
  const write = (m: M = 'ada', text = TEXT) => store.setAccount(m, DAY, { text, basedOn: dayHash(stored().items) })
  return { ...h, store, stored, write }
}

describe('remove', () => {
  it('hides an item and deletes nothing', async () => {
    const { store, stored, f } = await setup()
    const out = await store.remove('bo', DAY, 'camera-roll:p1')
    expect(out).toEqual({ day: DAY, key: 'camera-roll:p1', removedCount: 1 })
    expect(stored().items['camera-roll:p1']).toMatchObject({ kind: 'photo', by: ['ada'], media: { id: 'upload-photo-1' }, removed: { by: 'bo' } })
    expect(f.raw('journey_media', 'upload-photo-1')).toBeDefined()
  })

  it('either member removes any item, their own or the other one', async () => {
    const { store, stored } = await setup()
    await store.remove('ada', DAY, 'shipped:r1')
    await store.remove('bo', DAY, 'camera-roll:p1')
    expect(stored().items['shipped:r1'].removed?.by).toBe('ada')
    expect(stored().items['camera-roll:p1'].removed?.by).toBe('bo')
  })

  it('has search forget the item before it answers', async () => {
    const { store, host, calls } = await setup()
    let forgotten = false
    vi.mocked(host.forget!.item).mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 10))
      forgotten = true
    })
    await store.remove('bo', DAY, 'shipped:r1')
    expect(forgotten).toBe(true)
    expect(host.forget!.item).toHaveBeenCalledWith(DAY, 'shipped:r1')
    expect(calls).toEqual([])
  })

  it('a forget that fails never fails the removal, and is logged', async () => {
    const { store, stored, host } = await setup()
    vi.mocked(host.forget!.item).mockRejectedValueOnce(new Error('index down'))
    await expect(store.remove('bo', DAY, 'shipped:r1')).resolves.toMatchObject({ removedCount: 1 })
    expect(stored().items['shipped:r1'].removed?.by).toBe('bo')
    expect(host.log).toHaveBeenCalledWith('journey: forget item failed', expect.any(Error))
  })

  it('removing again keeps the first removal, and asks search to forget again', async () => {
    const { store, stored, calls } = await setup()
    await store.remove('bo', DAY, 'shipped:r1')
    const first = stored().items['shipped:r1'].removed
    const again = await store.remove('ada', DAY, 'shipped:r1')
    expect(again.removedCount).toBe(1)
    expect(stored().items['shipped:r1'].removed).toEqual(first)
    expect(calls).toEqual([`forget.item:${DAY}:shipped:r1`, `forget.item:${DAY}:shipped:r1`])
  })

  it('removes the one item a merged call is, under either machine key', async () => {
    const { store, calls } = await setup()
    const out = await store.remove('ada', DAY, 'conversations:b7')
    expect(out.key).toBe('conversations:a1')
    expect(calls).toEqual([`forget.item:${DAY}:conversations:a1`])
  })

  it('on a day already written up, withholds the account and has search forget it too', async () => {
    const { store, stored, calls, write } = await setup()
    await write()
    calls.length = 0
    await store.remove('bo', DAY, 'shipped:r1')
    expect(stored()).toMatchObject({ accountStale: true, accountWithheld: true })
    expect(calls).toEqual([`forget.item:${DAY}:shipped:r1`, `forget.day:${DAY}`])
  })

  it('refuses a key or a day it does not hold', async () => {
    const { store } = await setup()
    await expect(store.remove('bo', DAY, 'shipped:nope')).rejects.toMatchObject({ status: 404, message: 'no such item on this day' })
    await expect(store.remove('bo', '2026-10-11', 'shipped:r1')).rejects.toMatchObject({ status: 404, message: 'no such day' })
    await expect(store.remove('bo', DAY, 'a b')).rejects.toMatchObject({ status: 400 })
  })

  it('a removed key is refused when a machine sends it again, and named so the machine stops', async () => {
    const { store } = await setup()
    await store.remove('bo', DAY, 'shipped:r1')
    const answer = await store.contribute('ada', DAY, { items: [SHIPPED] })
    expect(answer.results).toEqual([{ key: 'shipped:r1', status: 'refused', reason: 'removed by a member' }])
    expect(answer.refused).toEqual(['shipped:r1'])
  })
})

describe('removed', () => {
  it('lists what was removed, by whom and when, and never the media', async () => {
    const { store } = await setup()
    await store.remove('bo', DAY, 'camera-roll:p1')
    await store.remove('ada', DAY, 'shipped:r1')
    const rows = await store.removed(DAY)
    expect(rows.map((r) => ({ key: r.key, kind: r.kind, title: r.title, by: r.by }))).toEqual(expect.arrayContaining([
      { key: 'camera-roll:p1', kind: 'photo', title: undefined, by: 'bo' },
      { key: 'shipped:r1', kind: 'shipped', title: 'Released 0.1.0', by: 'ada' },
    ]))
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => typeof r.at === 'string')).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('upload-photo-1')
  })

  it('is empty when nothing was removed, and refuses a day with no record', async () => {
    const { store } = await setup()
    expect(await store.removed(DAY)).toEqual([])
    await expect(store.removed('2026-10-11')).rejects.toMatchObject({ status: 404 })
  })
})

describe('restore', () => {
  it('puts a removed item back and tells search about it again', async () => {
    const { store, stored, calls } = await setup()
    await store.remove('bo', DAY, 'camera-roll:p1')
    calls.length = 0
    const out = await store.restore('ada', DAY, 'camera-roll:p1')
    expect(out).toEqual({ day: DAY, key: 'camera-roll:p1', removedCount: 0 })
    expect(stored().items['camera-roll:p1']).not.toHaveProperty('removed')
    expect(calls).toEqual([`index.item:${DAY}:camera-roll:p1`])
  })

  it('a restored key is taken again as already there', async () => {
    const { store } = await setup()
    await store.remove('bo', DAY, 'shipped:r1')
    await store.restore('bo', DAY, 'shipped:r1')
    expect((await store.contribute('ada', DAY, { items: [SHIPPED] })).results).toEqual([{ key: 'shipped:r1', status: 'present' }])
  })

  it('marks a written account stale', async () => {
    const { store, stored, write } = await setup()
    await write()
    await store.remove('bo', DAY, 'shipped:r1')
    await store.restore('bo', DAY, 'shipped:r1')
    expect(stored().accountStale).toBe(true)
  })

  it('restoring what is not removed changes nothing and tells nobody; an unknown key is refused', async () => {
    const { store, calls } = await setup()
    await store.restore('bo', DAY, 'shipped:r1')
    expect(calls).toEqual([])
    await expect(store.restore('bo', DAY, 'shipped:nope')).rejects.toMatchObject({ status: 404 })
    await expect(store.restore('bo', '2026-10-11', 'shipped:r1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('setAccount', () => {
  it('writes the account from the day as it stands, tells search, and tells the other member once', async () => {
    const { stored, calls, write } = await setup()
    const hash = dayHash(stored().items)
    expect(await write()).toEqual({ day: DAY, hash, first: true })
    expect(stored().account).toMatchObject({ text: TEXT, by: 'ada', basedOn: hash })
    expect(calls).toEqual([`index.day:${DAY}`, `announce.dayWritten:${DAY}:ada`])
  })

  it('a rewrite is quiet, whoever writes it', async () => {
    const { host, calls, write } = await setup()
    await write('ada')
    const again = await write('bo', 'A shorter telling.')
    expect(again.first).toBe(false)
    await write('ada', 'A third telling.')
    expect(host.announce.dayWritten).toHaveBeenCalledTimes(1)
    expect(calls.filter((c) => c.startsWith('index.day'))).toHaveLength(3)
  })

  it('refuses an account written from a day that has since changed, with the hash to read again from', async () => {
    const { store, stored, host } = await setup()
    const old = dayHash(stored().items)
    await store.contribute('bo', DAY, { items: [{ key: 'messages:t1', kind: 'text', at: at('11:30'), words: 'Shipping it today.' }] })
    await expect(store.setAccount('ada', DAY, { text: TEXT, basedOn: old })).rejects.toMatchObject({
      status: 409, message: 'the day changed since it was read', extra: { hash: dayHash(stored().items) },
    })
    expect(stored()).not.toHaveProperty('account')
    expect(host.announce.dayWritten).not.toHaveBeenCalled()
  })

  it('refuses words it cannot keep, a hash that is not one, and a day with no record', async () => {
    const { store, stored } = await setup()
    const basedOn = dayHash(stored().items)
    await expect(store.setAccount('ada', DAY, { text: '# A heading', basedOn })).rejects.toMatchObject({ status: 400 })
    await expect(store.setAccount('ada', DAY, { text: '', basedOn })).rejects.toMatchObject({ status: 400 })
    await expect(store.setAccount('ada', DAY, { text: TEXT, basedOn: 'nope' })).rejects.toMatchObject({ status: 400 })
    await expect(store.setAccount('ada', DAY, null)).rejects.toMatchObject({ status: 400 })
    await expect(store.setAccount('ada', '2026-10-11', { text: TEXT, basedOn })).rejects.toMatchObject({ status: 404 })
  })

  it('an announcement that throws never fails the write, and is logged', async () => {
    const { stored, host, write } = await setup()
    vi.mocked(host.announce.dayWritten).mockImplementationOnce(() => { throw new Error('push down') })
    await expect(write()).resolves.toMatchObject({ first: true })
    expect(stored().account?.text).toBe(TEXT)
    expect(host.log).toHaveBeenCalledWith('journey: announce dayWritten failed', expect.any(Error))
  })

  it('an announcement that rejects later is logged too', async () => {
    const { host, write } = await setup()
    vi.mocked(host.announce.dayWritten).mockImplementationOnce(async () => { throw new Error('push down') })
    await write()
    await new Promise((r) => setTimeout(r, 0))
    expect(host.log).toHaveBeenCalledWith('journey: announce dayWritten failed', expect.any(Error))
  })

  it('writing again after a removal clears the marks, and is still not the first', async () => {
    const { store, stored, host, write } = await setup()
    await write()
    await store.remove('bo', DAY, 'shipped:r1')
    const again = await write('bo', 'Ada and Bo planned the week.')
    expect(again.first).toBe(false)
    expect(stored()).not.toHaveProperty('accountStale')
    expect(stored()).not.toHaveProperty('accountWithheld')
    expect(host.announce.dayWritten).toHaveBeenCalledTimes(1)
  })
})

describe('two accounts at once', () => {
  it('two accounts written at once announce the day exactly once', async () => {
    const { store, stored, host } = await setup()
    const basedOn = dayHash(stored().items)
    const [a, b] = await Promise.all([
      store.setAccount('ada', DAY, { text: 'Ada telling.', basedOn }),
      store.setAccount('bo', DAY, { text: 'Bo telling.', basedOn }),
    ])
    expect(host.announce.dayWritten).toHaveBeenCalledTimes(1)
    expect([a.first, b.first].sort()).toEqual([false, true])
    expect(['Ada telling.', 'Bo telling.']).toContain(stored().account?.text)
  })
})

describe('a merge after the day was read', () => {
  it('marks the account stale, withholds it when narrowed, and refuses a write from the old hash', async () => {
    const h = fakeHost()
    const store = createJourneyStore(h.host)
    const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
    await store.contribute('ada', DAY, { items: [CALL] })
    const read = dayHash(stored().items)
    await store.setAccount('ada', DAY, { text: TEXT, basedOn: read })
    await store.contribute('bo', DAY, { items: [{ ...CALL, key: 'conversations:b7', summary: undefined, others: true, line: 'A client joined.' }] })
    expect(stored()).toMatchObject({ accountStale: true, accountWithheld: true })
    await expect(store.setAccount('ada', DAY, { text: 'From the purged summary.', basedOn: read })).rejects.toMatchObject({ status: 409, extra: { hash: dayHash(stored().items) } })
  })
})
