// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dayHash } from '../day-hash.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const noon = (day: string, minute = 0) => `${day}T12:${String(minute).padStart(2, '0')}:00-05:00`
const shipped = (day: string, n = 1) => ({ key: `shipped:${day}:${n}`, kind: 'shipped', at: noon(day, n), title: `Released ${n} on ${day}` })
const photo = (day: string, n: number) => ({ key: `camera-roll:${day}:${n}`, kind: 'photo', at: noon(day, 10 + n), media: { uploadId: `upload-${day}-${n}`, kind: 'photo' } })
const TEXT = 'Ada and Bo shipped.\n\nIt went well.'

function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const stored = (day: string) => h.f.raw('journey', day) as unknown as DayRecord<M>
  const write = (day: string) => store.setAccount('ada', day, { text: TEXT, basedOn: dayHash(stored(day).items) })
  return { ...h, store, stored, write }
}

describe('listDays', () => {
  it('lists days newest first, each with its count, its thumbnails and the first line of its account', async () => {
    const { store, write } = setup()
    await store.contribute('ada', '2026-10-10', { items: [shipped('2026-10-10')] })
    await store.contribute('ada', '2026-10-12', { items: [shipped('2026-10-12'), photo('2026-10-12', 1)] })
    await store.contribute('bo', '2026-10-11', { items: [shipped('2026-10-11')] })
    await write('2026-10-12')
    expect(await store.listDays()).toEqual({
      days: [
        { day: '2026-10-12', firstLine: 'Ada and Bo shipped.', thumbs: ['signed:p/thumb/upload-2026-10-12-1.jpg'], count: 2 },
        { day: '2026-10-11', firstLine: null, thumbs: [], count: 1 },
        { day: '2026-10-10', firstLine: null, thumbs: [], count: 1 },
      ],
      next: null,
    })
  })

  it('shows at most four thumbnails for a day', async () => {
    const { store } = setup()
    await store.contribute('ada', '2026-10-12', { items: [1, 2, 3, 4, 5].map((n) => photo('2026-10-12', n)) })
    const { days } = await store.listDays()
    expect(days[0].thumbs).toHaveLength(4)
    expect(days[0].count).toBe(5)
  })

  it('pages by a date cursor', async () => {
    const { store } = setup()
    for (const day of ['2026-10-10', '2026-10-11', '2026-10-12']) await store.contribute('ada', day, { items: [shipped(day)] })
    const first = await store.listDays({ limit: 2 })
    expect(first.days.map((d) => d.day)).toEqual(['2026-10-12', '2026-10-11'])
    expect(first.next).toBe('2026-10-11')
    const second = await store.listDays({ limit: '2', before: first.next })
    expect(second.days.map((d) => d.day)).toEqual(['2026-10-10'])
    expect(second.next).toBeNull()
  })

  it('a day with nothing left on it is not listed, and does not stop the paging', async () => {
    const { store } = setup()
    for (const day of ['2026-10-10', '2026-10-11', '2026-10-12']) await store.contribute('ada', day, { items: [shipped(day)] })
    await store.remove('bo', '2026-10-11', 'shipped:2026-10-11:1')
    const first = await store.listDays({ limit: 2 })
    expect(first.days.map((d) => d.day)).toEqual(['2026-10-12'])
    expect(first.next).toBe('2026-10-11')
    expect((await store.listDays({ limit: 2, before: first.next })).days.map((d) => d.day)).toEqual(['2026-10-10'])
  })

  it('is empty before anything was contributed', async () => {
    expect(await setup().store.listDays()).toEqual({ days: [], next: null })
  })

  it('refuses a cursor or a page size it cannot read', async () => {
    const { store } = setup()
    await expect(store.listDays({ before: 'yesterday' })).rejects.toMatchObject({ status: 400 })
    await expect(store.listDays({ limit: 500 })).rejects.toMatchObject({ status: 400 })
  })
})

describe('getDay', () => {
  it('is the day page: the account, then the four groups, each item marked with whose machine sent it', async () => {
    const { store, write } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day), photo(day, 1), { key: 'conversations:a1', kind: 'call', at: noon(day, 2), title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1' }] })
    await store.contribute('bo', day, { items: [{ key: 'messages:t1', kind: 'text', at: noon(day, 30), words: 'Shipping it today.' }, { key: 'conversations:b7', kind: 'call', at: noon(day, 2), title: 'Weekly sync', summary: 'From Bo.', meetingKey: 'mk-1' }] })
    await write(day)
    const view = await store.getDay(day)
    expect(view?.account).toMatchObject({ text: TEXT, by: 'ada' })
    expect(view?.groups.map((g) => [g.name, g.items.map((i) => [i.key, i.by])])).toEqual([
      ['calls', [['conversations:a1', ['ada', 'bo']]]],
      ['media', [[`camera-roll:${day}:1`, ['ada']]]],
      ['texts', [['messages:t1', ['bo']]]],
      ['shipped', [[`shipped:${day}:1`, ['ada']]]],
    ])
    expect(view?.groups[0].items[0].summaries).toEqual([{ by: 'ada', text: 'From Ada.' }, { by: 'bo', text: 'From Bo.' }])
    expect(view?.groups[1].items[0].media).toMatchObject({ kind: 'photo', thumbUrl: `signed:p/thumb/upload-${day}-1.jpg`, displayUrl: `signed:p/display/upload-${day}-1.jpg` })
    expect(view?.removedCount).toBe(0)
  })

  it('leaves a removed item out, counts it, and withholds an account written before it was removed', async () => {
    const { store, write } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day), photo(day, 1)] })
    await write(day)
    await store.remove('bo', day, `camera-roll:${day}:1`)
    const view = await store.getDay(day)
    expect(view?.groups[1].items).toEqual([])
    expect(view?.removedCount).toBe(1)
    expect(view?.account).toBeNull()
    expect(view?.accountPending).toBe(true)
    expect(JSON.stringify(view)).not.toContain('upload-2026-10-12-1')
  })

  it('is null for a day with no record, and refuses a day that is not one', async () => {
    const { store } = setup()
    expect(await store.getDay('2026-10-12')).toBeNull()
    await expect(store.getDay('someday')).rejects.toMatchObject({ status: 400 })
  })
})

describe('agentDay', () => {
  it('hands the writer every visible item, the hash to send back, and no URL', async () => {
    const { store, host } = setup()
    const day = '2026-10-12'
    const answer = await store.contribute('ada', day, { items: [shipped(day), photo(day, 1)] })
    const out = await store.agentDay(day)
    expect(out.hash).toBe(answer.hash)
    expect(out.items).toEqual([
      { key: `shipped:${day}:1`, kind: 'shipped', at: '2026-10-12T17:01:00.000Z', by: ['ada'], title: `Released 1 on ${day}`, hasMedia: false },
      { key: `camera-roll:${day}:1`, kind: 'photo', at: '2026-10-12T17:11:00.000Z', by: ['ada'], hasMedia: true, mediaKind: 'photo' },
    ])
    expect(out.account).toBeNull()
    expect(out.accountStale).toBe(false)
    expect(host.media.signedUrl).not.toHaveBeenCalled()
  })

  it('says the account is stale when something arrives after it was written', async () => {
    const { store, write } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day)] })
    await write(day)
    expect(await store.agentDay(day)).toMatchObject({ accountStale: false, account: { text: TEXT, by: 'ada' } })
    await store.contribute('bo', day, { items: [shipped(day, 2)] })
    expect((await store.agentDay(day)).accountStale).toBe(true)
  })

  it('after a removal: the item is gone, the account is owed, and the old account is not handed back', async () => {
    const { store, write } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day), shipped(day, 2)] })
    await write(day)
    await store.remove('bo', day, `shipped:${day}:2`)
    const out = await store.agentDay(day)
    expect(out.items.map((i) => i.key)).toEqual([`shipped:${day}:1`])
    expect(out.accountStale).toBe(true)
    expect(out.account).toBeNull()
    await expect(store.setAccount('ada', day, { text: 'Ada shipped once.', basedOn: out.hash })).resolves.toMatchObject({ first: false })
    expect(await store.agentDay(day)).toMatchObject({ accountStale: false, account: { text: 'Ada shipped once.' } })
  })

  it('reads a day nobody has contributed to as empty, with the hash of nothing', async () => {
    const { store } = setup()
    expect(await store.agentDay('2026-10-12')).toEqual({ day: '2026-10-12', timeZone: 'America/Chicago', hash: dayHash({}), account: null, accountStale: false, items: [] })
  })
})

describe('agentDay says which zone the day is counted in', () => {
  it('is the zone the host named', async () => {
    const h = fakeHost({ timeZone: 'Europe/Lisbon' })
    const store = createJourneyStore(h.host)
    await store.contribute('ada', '2026-10-12', { items: [{ key: 'shipped:x', kind: 'shipped', at: '2026-10-12T12:00:00+01:00', title: 'Released' }] })
    expect((await store.agentDay('2026-10-12')).timeZone).toBe('Europe/Lisbon')
  })
})

describe('searchDay', () => {
  it('is null for a day with no record, and refuses a day that is not one', async () => {
    const { store } = setup()
    expect(await store.searchDay('2026-10-12')).toBeNull()
    await expect(store.searchDay('someday')).rejects.toMatchObject({ status: 400 })
  })

  it('hands the indexer every visible item and the account, and signs nothing', async () => {
    const { store, write, host } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day), photo(day, 1)] })
    await write(day)
    expect(await store.searchDay(day)).toEqual({
      day,
      account: TEXT,
      items: [
        { key: `shipped:${day}:1`, kind: 'shipped', at: '2026-10-12T17:01:00.000Z', by: ['ada'], title: `Released 1 on ${day}` },
        { key: `camera-roll:${day}:1`, kind: 'photo', at: '2026-10-12T17:11:00.000Z', by: ['ada'], thumbPath: `p/thumb/upload-${day}-1.jpg` },
      ],
    })
    expect(host.media.signedUrl).not.toHaveBeenCalled()
  })

  it('never holds a removed item, nor the account withheld with it', async () => {
    const { store, write } = setup()
    const day = '2026-10-12'
    await store.contribute('ada', day, { items: [shipped(day), photo(day, 1)] })
    await write(day)
    await store.remove('bo', day, `camera-roll:${day}:1`)
    expect(await store.searchDay(day)).toEqual({ day, items: [expect.objectContaining({ key: `shipped:${day}:1` })] })
  })

  it('holds nothing of an item whose forget search has not confirmed', async () => {
    const { store, host } = setup()
    const day = '2026-10-12'
    const call = { key: 'conversations:a1', kind: 'call', at: noon(day, 2), title: 'Weekly sync', summary: 'From Ada.', meetingKey: 'mk-1' }
    await store.contribute('ada', day, { items: [shipped(day), call] })
    host.forget!.item = async () => { throw new Error('index down') }
    await store.contribute('bo', day, { items: [{ ...call, key: 'conversations:b7', summary: undefined, others: true, line: 'A client joined.' }] })
    expect((await store.searchDay(day))!.items.map((i) => i.key)).toEqual([`shipped:${day}:1`])
  })
})
