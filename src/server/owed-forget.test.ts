// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { dayHash } from '../day-hash.js'
import { createJourneyHandlers } from './handlers.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const DAY = '2026-10-12'
const at = (hhmm: string) => `2026-10-12T${hhmm}:00-05:00`
const RECORDING = { uploadId: 'upload-video-1', kind: 'video', durationSec: 60, width: 1280, height: 720 }
const CALL = { key: 'conversations:a1', kind: 'call', at: at('10:00'), title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1', media: RECORDING }
const OTHERS = { key: 'conversations:b7', kind: 'call', at: at('10:00'), title: 'Weekly sync', meetingKey: 'mk-1', others: true, line: 'A client joined.' }
const SHIPPED = { key: 'shipped:r1', kind: 'shipped', at: at('16:00'), title: 'Released 0.1.0' }
const TEXT = { key: 'messages:t1', kind: 'text', at: at('11:30'), words: 'Shipping it today.' }
const A1 = 'conversations:a1'

async function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  await store.contribute('ada', DAY, { items: [CALL, SHIPPED] })
  h.calls.length = 0
  vi.mocked(h.host.index!.item).mockClear()
  const write = (text = 'Ada and Bo met, then shipped.') => store.setAccount('ada', DAY, { text, basedOn: dayHash(stored().items) })
  const searchDown = () => {
    vi.mocked(h.host.forget!.item).mockRejectedValue(new Error('index down'))
    vi.mocked(h.host.forget!.day!).mockRejectedValue(new Error('index down'))
  }
  const searchUp = () => {
    vi.mocked(h.host.forget!.item).mockImplementation(async (day: string, key: string) => { h.calls.push(`forget.item:${day}:${key}`) })
    vi.mocked(h.host.forget!.day!).mockImplementation(async (day: string) => { h.calls.push(`forget.day:${day}`) })
  }
  return { ...h, store, stored, write, searchDown, searchUp }
}

describe('a narrowing merge owes search a forget until search confirms it', () => {
  it('when search forgets, nothing stays owed', async () => {
    const { store, stored, calls } = await setup()
    const answer = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(answer.results).toEqual([{ index: 0, key: 'conversations:b7', status: 'merged' }])
    expect(stored().items[A1]).not.toHaveProperty('owesForget')
    expect(stored()).not.toHaveProperty('accountOwesForget')
    expect(calls).toEqual([`forget.item:${DAY}:${A1}`, `index.item:${DAY}:${A1}`])
  })

  it('when search cannot forget, the mark stays on the item, the row is failed, and the item is not indexed', async () => {
    const { store, stored, host, searchDown } = await setup()
    searchDown()
    const answer = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(answer.results).toEqual([{ index: 0, key: 'conversations:b7', status: 'failed', reason: 'merged, but search could not be updated' }])
    expect(stored().items[A1]).toMatchObject({ others: true, owesForget: expect.any(String) })
    expect(stored().items[A1]).not.toHaveProperty('summaries')
    expect(host.index!.item).not.toHaveBeenCalledWith(DAY, A1)
  })

  it('the resend is present, runs the forget again, clears the mark and only then indexes', async () => {
    const { store, stored, host, calls, searchDown, searchUp } = await setup()
    searchDown()
    await store.contribute('bo', DAY, { items: [OTHERS] })
    searchUp()
    vi.mocked(host.forget!.item).mockClear()
    const again = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(again.results).toEqual([{ index: 0, key: 'conversations:b7', status: 'present' }])
    expect(host.forget!.item).toHaveBeenCalledTimes(1)
    expect(stored().items[A1]).not.toHaveProperty('owesForget')
    expect(calls).toEqual([`forget.item:${DAY}:${A1}`, `index.item:${DAY}:${A1}`])
  })

  it('forgets the account of the day too, when the day had one, and withholds it', async () => {
    const { store, stored, calls, write } = await setup()
    await write()
    calls.length = 0
    await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(calls).toEqual([`forget.item:${DAY}:${A1}`, `forget.day:${DAY}`, `index.item:${DAY}:${A1}`])
    expect(stored()).toMatchObject({ accountWithheld: true })
    expect(stored()).not.toHaveProperty('accountOwesForget')
  })

  it('an account forget that fails stays owed, fails the row, and is retried by a later call of any kind', async () => {
    const { store, stored, host, calls, write } = await setup()
    await write()
    calls.length = 0
    vi.mocked(host.forget!.day!).mockRejectedValueOnce(new Error('index down'))
    const answer = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(answer.results[0]).toMatchObject({ status: 'failed', reason: 'merged, but search could not be updated' })
    expect(stored().accountOwesForget).toEqual(expect.any(String))
    expect(stored().items[A1]).not.toHaveProperty('owesForget')
    calls.length = 0
    await store.contribute('ada', DAY, { items: [TEXT] })
    expect(calls).toEqual([`forget.day:${DAY}`, `index.item:${DAY}:messages:t1`])
    expect(stored()).not.toHaveProperty('accountOwesForget')
  })

  it('while the forget is owed, no call indexes the item: not a third recording, not a restore', async () => {
    const { store, stored, host, searchDown } = await setup()
    searchDown()
    await store.contribute('bo', DAY, { items: [OTHERS] })
    await store.contribute('bo', DAY, { items: [{ ...OTHERS, key: 'conversations:b8' }, TEXT] })
    expect(stored().items[A1].aka).toEqual(['conversations:b7', 'conversations:b8'])
    await expect(store.remove('ada', DAY, A1)).rejects.toMatchObject({ status: 409 })
    await store.restore('ada', DAY, A1)
    expect(stored().items[A1]).not.toHaveProperty('removed')
    expect(stored().items[A1].owesForget).toEqual(expect.any(String))
    expect(host.index!.item).not.toHaveBeenCalledWith(DAY, A1)
    expect(host.index!.item).toHaveBeenCalledWith(DAY, 'messages:t1')
  })

  it('each owed forget is tried once per call, not once before the write and once after', async () => {
    const { store, host, searchDown } = await setup()
    searchDown()
    await store.contribute('bo', DAY, { items: [OTHERS] })
    vi.mocked(host.forget!.item).mockClear()
    await store.contribute('ada', DAY, { items: [TEXT] })
    expect(host.forget!.item).toHaveBeenCalledTimes(1)
  })
})

describe('a removal owes search a forget in the same way', () => {
  it('when search forgets, nothing stays owed', async () => {
    const { store, stored, write } = await setup()
    await write()
    await store.remove('bo', DAY, 'shipped:r1')
    expect(stored().items['shipped:r1']).toMatchObject({ removed: { by: 'bo' } })
    expect(stored().items['shipped:r1']).not.toHaveProperty('owesForget')
    expect(stored()).not.toHaveProperty('accountOwesForget')
  })

  it('when search cannot, the 409 says the item is removed, and the marks stay', async () => {
    const { store, stored, write, searchDown } = await setup()
    await write()
    searchDown()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({
      status: 409, message: 'Removed. Search will catch up shortly.', extra: { removed: true },
    })
    expect(stored().items['shipped:r1'].owesForget).toEqual(expect.any(String))
    expect(stored().accountOwesForget).toEqual(expect.any(String))
  })

  it('the route answers that 409 with removed: true beside the words', async () => {
    const { store, host, searchDown } = await setup()
    const handlers = createJourneyHandlers(host, store)
    searchDown()
    const res = await handlers.item.DELETE(new Request(`https://app.test/api/journey/days/${DAY}/item?key=shipped%3Ar1`, { method: 'DELETE' }), { params: Promise.resolve({ day: DAY }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ removed: true, error: 'Removed. Search will catch up shortly.' })
    const missing = await handlers.item.DELETE(new Request(`https://app.test/api/journey/days/${DAY}/item?key=shipped%3Anope`, { method: 'DELETE' }), { params: Promise.resolve({ day: DAY }) })
    expect(await missing.json()).toEqual({ error: 'no such item on this day' })
  })

  it.each([
    ['a contribution', (s: Awaited<ReturnType<typeof setup>>) => s.store.contribute('ada', DAY, { items: [TEXT] })],
    ['a contribution of what is already there', (s: Awaited<ReturnType<typeof setup>>) => s.store.contribute('ada', DAY, { items: [SHIPPED] })],
    ['the removal of another item', (s: Awaited<ReturnType<typeof setup>>) => s.store.remove('ada', DAY, A1)],
    ['a restore', (s: Awaited<ReturnType<typeof setup>>) => s.store.restore('ada', DAY, 'shipped:r1')],
    ['an account', (s: Awaited<ReturnType<typeof setup>>) => s.store.setAccount('ada', DAY, { text: 'Ada met.', basedOn: dayHash(s.stored().items) })],
  ])('%s retries the forget a removal still owes, and clears it', async (_name, later) => {
    const s = await setup()
    await s.write()
    s.searchDown()
    await expect(s.store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    s.searchUp()
    s.calls.length = 0
    await later(s)
    expect(s.calls.slice(0, 2)).toEqual([`forget.item:${DAY}:shipped:r1`, `forget.day:${DAY}`])
    expect(s.stored().items['shipped:r1']).not.toHaveProperty('owesForget')
    expect(s.stored()).not.toHaveProperty('accountOwesForget')
  })

  it('a call that is itself refused still pays what the day owes first', async () => {
    const s = await setup()
    await s.write()
    s.searchDown()
    await expect(s.store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    const owing = () => [s.stored().items['shipped:r1'].owesForget !== undefined, s.stored().accountOwesForget !== undefined]

    s.searchUp()
    await expect(s.store.remove('bo', DAY, 'shipped:nope')).rejects.toMatchObject({ status: 404 })
    expect(owing()).toEqual([false, false])

    // The debt is put back by hand, so each refused call below starts from a day that owes.
    const rec = s.stored()
    rec.items['shipped:r1'].owesForget = '2026-10-12T20:00:00.000Z'
    s.f.seed('journey', { [DAY]: rec })
    await expect(s.store.setAccount('ada', DAY, { text: 'Ada met.', basedOn: '0'.repeat(16) })).rejects.toMatchObject({ status: 409 })
    expect(owing()).toEqual([false, false])

    s.f.seed('journey', { [DAY]: rec })
    const db = s.host.db()
    s.host.db = () => ({ ...db, collection: (name: string) => (name === 'journey_media' ? { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE') } }) } : db.collection(name)) }) as unknown as typeof db
    await expect(s.store.contribute('ada', DAY, { items: [{ key: 'camera-roll:p9', kind: 'photo', at: at('12:00'), media: { uploadId: 'upload-photo-9', kind: 'photo' } }] })).rejects.toThrow('UNAVAILABLE')
    expect(owing()).toEqual([false, false])
  })

  it('a removal answers for its own item only: another item still owing does not fail it', async () => {
    const { store, host, searchDown } = await setup()
    searchDown()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    vi.mocked(host.forget!.item).mockImplementation(async (_day: string, key: string) => { if (key === 'shipped:r1') throw new Error('index down') })
    await expect(store.remove('bo', DAY, A1)).resolves.toMatchObject({ key: A1, removedCount: 2 })
  })

  it('a repeat of a removal that still cannot be forgotten asks search once, and answers 409 again', async () => {
    const { store, host, searchDown } = await setup()
    searchDown()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    vi.mocked(host.forget!.item).mockClear()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409, extra: { removed: true } })
    expect(host.forget!.item).toHaveBeenCalledTimes(1)
  })

  it('an item restored while its forget is owed is indexed once search has forgotten it', async () => {
    const { store, stored, calls, searchDown, searchUp } = await setup()
    searchDown()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    await store.restore('ada', DAY, 'shipped:r1')
    expect(calls).toEqual([])
    searchUp()
    await store.contribute('ada', DAY, { items: [SHIPPED] })
    expect(calls).toEqual([`forget.item:${DAY}:shipped:r1`, `index.item:${DAY}:shipped:r1`])
    expect(stored().items['shipped:r1']).not.toHaveProperty('owesForget')
  })

  it('an account written while its forget is owed is indexed once search has forgotten the old one', async () => {
    const { store, stored, calls, write, searchDown, searchUp } = await setup()
    await write()
    calls.length = 0
    searchDown()
    await expect(store.remove('bo', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409 })
    await write('Ada and Bo met.')
    expect(calls).toEqual([])
    expect(stored()).not.toHaveProperty('accountWithheld')
    searchUp()
    await store.contribute('ada', DAY, { items: [TEXT] })
    expect(calls).toEqual([`forget.item:${DAY}:shipped:r1`, `forget.day:${DAY}`, `index.day:${DAY}`, `index.item:${DAY}:messages:t1`])
  })

  it('a host with no forget hooks owes nothing for long: the marks are cleared', async () => {
    const h = fakeHost()
    const { forget: _none, ...host } = h.host
    const store = createJourneyStore(host)
    await store.contribute('ada', DAY, { items: [CALL, SHIPPED] })
    await store.remove('bo', DAY, 'shipped:r1')
    await store.contribute('bo', DAY, { items: [OTHERS] })
    const rec = h.f.raw('journey', DAY) as unknown as DayRecord<M>
    expect(rec.items['shipped:r1']).not.toHaveProperty('owesForget')
    expect(rec.items[A1]).not.toHaveProperty('owesForget')
  })
})

describe('a removal answers only for a forget asked after it was saved', () => {
  // Every transaction is a line in the call log, so the order of a write and a forget can be read.
  const logWrites = (s: Awaited<ReturnType<typeof setup>>) => {
    const db = s.host.db()
    s.host.db = () => ({ ...db, runTransaction: async (fn: never) => { const r = await db.runTransaction(fn); s.calls.push('write'); return r } }) as unknown as typeof db
  }
  const owing = async (s: Awaited<ReturnType<typeof setup>>) => {
    s.searchDown()
    await s.store.contribute('bo', DAY, { items: [OTHERS] })
    s.searchUp()
    s.calls.length = 0
    logWrites(s)
  }

  it('an item that owed a forget is forgotten again after the removal is saved, and never indexed by the removal', async () => {
    const s = await setup()
    await owing(s)
    expect(s.stored().items[A1].owesForget).toEqual(expect.any(String))
    await expect(s.store.remove('ada', DAY, A1)).resolves.toMatchObject({ key: A1 })
    const forgets = s.calls.flatMap((c, i) => (c === `forget.item:${DAY}:${A1}` ? [i] : []))
    const removalWrite = s.calls.findIndex((c, i) => c === 'write' && i > forgets[0] && s.calls.slice(forgets[0], i).filter((x) => x === 'write').length === 1)
    expect(forgets).toHaveLength(2)
    expect(forgets[1]).toBeGreaterThan(removalWrite)
    expect(s.calls.filter((c) => c.startsWith('index.item'))).toEqual([])
    expect(s.host.index!.item).not.toHaveBeenCalledWith(DAY, A1)
    expect(s.stored().items[A1]).not.toHaveProperty('owesForget')
  })

  it('a forget that worked before the removal and fails after it is a 409, the mark stays, and a repeat settles it', async () => {
    const s = await setup()
    await owing(s)
    vi.mocked(s.host.forget!.item).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('index down'))
    await expect(s.store.remove('ada', DAY, A1)).rejects.toMatchObject({ status: 409, extra: { removed: true } })
    expect(s.stored().items[A1]).toMatchObject({ removed: { by: 'ada' }, owesForget: expect.any(String) })
    expect(JSON.stringify(await s.store.getDay(DAY))).not.toContain('Weekly sync')
    await expect(s.store.remove('ada', DAY, A1)).resolves.toMatchObject({ key: A1 })
    expect(s.stored().items[A1]).not.toHaveProperty('owesForget')
    expect(s.host.index!.item).not.toHaveBeenCalledWith(DAY, A1)
  })

  it('the day forget is settled after the removal too', async () => {
    const s = await setup()
    await s.write()
    await owing(s)
    expect(s.stored().accountOwesForget).toEqual(expect.any(String))
    vi.mocked(s.host.forget!.day!).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('index down'))
    await expect(s.store.remove('ada', DAY, 'shipped:r1')).rejects.toMatchObject({ status: 409, extra: { removed: true } })
    expect(s.stored().accountOwesForget).toEqual(expect.any(String))
    await expect(s.store.remove('ada', DAY, 'shipped:r1')).resolves.toMatchObject({ key: 'shipped:r1' })
    expect(s.stored()).not.toHaveProperty('accountOwesForget')
  })

  it('a slow index started by an earlier call is not joined by one from the removal', async () => {
    const s = await setup()
    await owing(s)
    vi.mocked(s.host.index!.item).mockImplementation(() => new Promise<void>((done) => setTimeout(done, 30)))
    await s.store.remove('ada', DAY, A1)
    await new Promise((done) => setTimeout(done, 60))
    expect(s.host.index!.item).not.toHaveBeenCalledWith(DAY, A1)
  })
})

describe('a removed call never comes back with what the others-present rule forbids', () => {
  it('removed first, then the other machine says others were present: refused, narrowed, and restored narrow', async () => {
    const { store, stored, calls, host } = await setup()
    await store.remove('bo', DAY, A1)
    calls.length = 0
    const answer = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(answer.results).toEqual([{ index: 0, key: 'conversations:b7', status: 'refused', reason: 'removed by a member' }])
    expect(answer.refused).toEqual(['conversations:b7'])
    expect(calls).toEqual([`forget.item:${DAY}:${A1}`])
    expect(stored().items[A1]).toMatchObject({ others: true, line: 'A client joined.', title: 'Weekly sync', removed: { by: 'bo' } })
    expect(stored().items[A1]).not.toHaveProperty('owesForget')
    await store.restore('ada', DAY, A1)
    const page = JSON.stringify([await store.getDay(DAY), await store.agentDay(DAY), await store.listDays()])
    expect(page).toContain('A client joined.')
    expect(page).not.toContain('From Ada.')
    expect(page).not.toContain('upload-video-1')
    expect(JSON.stringify(stored())).not.toContain('From Ada.')
    expect(host.media.fileVideo).toHaveBeenCalledTimes(1)
  })

  it('a forget that fails for the narrowed removed call stays owed, and the restore is not indexed until it is paid', async () => {
    const { store, stored, calls, write, searchDown, searchUp } = await setup()
    await write()
    await store.remove('bo', DAY, A1)
    calls.length = 0
    searchDown()
    const answer = await store.contribute('bo', DAY, { items: [OTHERS] })
    expect(answer.results[0].status).toBe('refused')
    expect(stored().items[A1].owesForget).toEqual(expect.any(String))
    expect(stored().accountOwesForget).toEqual(expect.any(String))
    await store.restore('ada', DAY, A1)
    expect(calls).toEqual([])
    searchUp()
    await store.contribute('ada', DAY, { items: [SHIPPED] })
    expect(calls).toEqual([`forget.item:${DAY}:${A1}`, `forget.day:${DAY}`, `index.item:${DAY}:${A1}`])
  })

  it('the other order: the narrow call removed first, then the full one arrives: refused, nothing filed, restored narrow', async () => {
    const h = fakeHost()
    const store = createJourneyStore(h.host)
    const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
    await store.contribute('bo', DAY, { items: [OTHERS] })
    await store.remove('ada', DAY, 'conversations:b7')
    const before = stored()
    const answer = await store.contribute('ada', DAY, { items: [CALL] })
    expect(answer.results).toEqual([{ index: 0, key: A1, status: 'refused', reason: 'removed by a member' }])
    expect(stored()).toEqual(before)
    expect(h.host.media.fileVideo).not.toHaveBeenCalled()
    await store.restore('bo', DAY, 'conversations:b7')
    const page = JSON.stringify([await store.getDay(DAY), await store.agentDay(DAY)])
    expect(page).toContain('A client joined.')
    expect(page).not.toContain('From Ada.')
    expect(page).not.toContain('upload-video-1')
  })
})
