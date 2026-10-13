// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dayHash } from '../day-hash.js'
import { createJourneyHandlers } from './handlers.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

const DAY = '2026-10-12'
const at = (hhmm: string) => `2026-10-12T${hhmm}:00-05:00`
const SHIPPED = { key: 'shipped:repo/v0.1.0', kind: 'shipped', at: at('16:00'), title: 'Released 0.1.0' }
const TEXT_ITEM = { key: 'messages:t1', kind: 'text', at: at('11:30'), words: 'Shipping it today.' }
const TEXT = 'Ada and Bo shipped.'

const url = (path: string) => `https://app.test/api/journey${path}`
const get = (path: string) => new Request(url(path))
const send = (method: string, path: string, body?: unknown) =>
  new Request(url(path), { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
const on = (day = DAY) => ({ params: Promise.resolve({ day }) })
const keyed = (key: string) => `?key=${encodeURIComponent(key)}`

async function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const handlers = createJourneyHandlers(h.host, store)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  await store.contribute('ada', DAY, { items: [SHIPPED, TEXT_ITEM] })
  return { ...h, store, handlers, stored }
}

afterEach(() => { vi.restoreAllMocks() })

describe('member routes', () => {
  it('days.GET lists days and passes the cursor and the page size from the URL', async () => {
    const { handlers, store } = await setup()
    await store.contribute('ada', '2026-10-11', { items: [{ key: 'shipped:older', kind: 'shipped', at: '2026-10-11T12:00:00-05:00', title: 'Older' }] })
    const first = await handlers.days.GET(get('/days?limit=1'))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ days: [{ day: DAY, firstLine: null, thumbs: [], count: 2 }], next: DAY })
    const second = await handlers.days.GET(get(`/days?limit=1&before=${DAY}`))
    expect((await second.json()).days.map((d: { day: string }) => d.day)).toEqual(['2026-10-11'])
  })

  it('days.GET refuses a page size it cannot read, in words', async () => {
    const { handlers } = await setup()
    const res = await handlers.days.GET(get('/days?limit=lots'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/limit/)
  })

  it('day.GET is the day page, 404 for a day with no record, 400 for a day that is not one', async () => {
    const { handlers } = await setup()
    const res = await handlers.day.GET(get(`/days/${DAY}`), on())
    expect(res.status).toBe(200)
    expect((await res.json()).groups.map((g: { name: string; items: unknown[] }) => [g.name, g.items.length])).toEqual([['calls', 0], ['media', 0], ['texts', 1], ['shipped', 1]])
    expect((await handlers.day.GET(get('/days/2026-10-01'), on('2026-10-01'))).status).toBe(404)
    expect((await handlers.day.GET(get('/days/soon'), on('soon'))).status).toBe(400)
  })

  it('item.DELETE removes the item named in the query string, as the signed-in member', async () => {
    const { handlers, stored, host } = await setup()
    vi.mocked(host.member).mockResolvedValue('bo')
    const res = await handlers.item.DELETE(send('DELETE', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ day: DAY, key: SHIPPED.key, removedCount: 1 })
    expect(stored().items[SHIPPED.key].removed?.by).toBe('bo')
    expect(host.forget!.item).toHaveBeenCalledWith(DAY, SHIPPED.key)
  })

  it('item.DELETE and item.POST need a key', async () => {
    const { handlers } = await setup()
    const gone = await handlers.item.DELETE(send('DELETE', `/days/${DAY}/item`), on())
    expect(gone.status).toBe(400)
    expect(await gone.json()).toEqual({ error: 'key is required' })
    expect((await handlers.item.POST(send('POST', `/days/${DAY}/item`), on())).status).toBe(400)
    expect((await handlers.item.DELETE(send('DELETE', `/days/${DAY}/item${keyed('shipped:nope')}`), on())).status).toBe(404)
  })

  it('removed.GET lists what was removed, and item.POST puts one back', async () => {
    const { handlers, stored } = await setup()
    await handlers.item.DELETE(send('DELETE', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on())
    const list = await handlers.removed.GET(get(`/days/${DAY}/removed`), on())
    expect(list.status).toBe(200)
    expect((await list.json()).removed).toEqual([expect.objectContaining({ key: SHIPPED.key, kind: 'shipped', title: 'Released 0.1.0', by: 'ada' })])
    const back = await handlers.item.POST(send('POST', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on())
    expect(await back.json()).toEqual({ day: DAY, key: SHIPPED.key, removedCount: 0 })
    expect(stored().items[SHIPPED.key]).not.toHaveProperty('removed')
  })

  it('every member route answers 403 to a stranger, even one holding a valid agent key', async () => {
    const { handlers, host, stored } = await setup()
    vi.mocked(host.member).mockResolvedValue(null)
    const answers = await Promise.all([
      handlers.days.GET(get('/days')),
      handlers.day.GET(get(`/days/${DAY}`), on()),
      handlers.item.DELETE(send('DELETE', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on()),
      handlers.item.POST(send('POST', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on()),
      handlers.removed.GET(get(`/days/${DAY}/removed`), on()),
    ])
    for (const res of answers) {
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'private' })
    }
    expect(host.agent!.member).not.toHaveBeenCalled()
    expect(stored().items[SHIPPED.key]).not.toHaveProperty('removed')
  })
})

describe('agent routes', () => {
  const everyAgentRoute = (handlers: Awaited<ReturnType<typeof setup>>['handlers']) => Promise.all([
    handlers.agent.ticket.POST(send('POST', '/agent/ticket', { kind: 'photo' })),
    handlers.agent.items.POST(send('POST', `/agent/days/${DAY}/items`, { items: [SHIPPED] }), on()),
    handlers.agent.day.GET(get(`/agent/days/${DAY}`), on()),
    handlers.agent.account.PUT(send('PUT', `/agent/days/${DAY}/account`, { text: TEXT, basedOn: '0'.repeat(16) }), on()),
  ])

  it('every agent route answers 401 without an agent key, even to a signed-in member', async () => {
    const { handlers, host, stored } = await setup()
    vi.mocked(host.agent!.member).mockResolvedValue(null)
    for (const res of await everyAgentRoute(handlers)) {
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'agent key required' })
    }
    expect(host.member).not.toHaveBeenCalled()
    expect(stored()).not.toHaveProperty('account')
  })

  it('an app that gave no agent block answers 401 on every agent route', async () => {
    const { host } = await setup()
    const { agent: _none, ...withoutAgent } = host
    const handlers = createJourneyHandlers(withoutAgent)
    for (const res of await everyAgentRoute(handlers)) expect(res.status).toBe(401)
  })

  it('ticket.POST hands back the app own photo ticket under the name uploadId', async () => {
    const { handlers, host } = await setup()
    const res = await handlers.agent.ticket.POST(send('POST', '/agent/ticket', { kind: 'photo' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ uploadId: 'upload-photo-1', url: 'https://put.example/photo', headers: { 'Content-Type': 'image/jpeg' } })
    expect(host.agent!.photoTicket).toHaveBeenCalledWith('ada')
  })

  it('ticket.POST hands back a video ticket, and refuses any other kind', async () => {
    const { handlers, host } = await setup()
    const res = await handlers.agent.ticket.POST(send('POST', '/agent/ticket', { kind: 'video', contentType: 'video/mp4', size: 1024 }))
    expect(await res.json()).toEqual({
      uploadId: 'upload-video-1', videoUrl: 'https://put.example/video', posterUrl: 'https://put.example/poster',
      requiredHeaders: { video: { 'Content-Type': 'video/mp4' }, poster: { 'Content-Type': 'image/jpeg' } },
    })
    expect(host.agent!.videoTicket).toHaveBeenCalledWith('ada', { contentType: 'video/mp4', size: 1024 })
    const other = await handlers.agent.ticket.POST(send('POST', '/agent/ticket', { kind: 'audio' }))
    expect(other.status).toBe(400)
    expect(await other.json()).toEqual({ error: 'kind must be photo or video' })
  })

  it('items.POST contributes as the member the key acts as, and nobody else', async () => {
    const { handlers, host, stored } = await setup()
    vi.mocked(host.agent!.member).mockResolvedValue('bo')
    const res = await handlers.agent.items.POST(send('POST', `/agent/days/${DAY}/items`, { items: [{ key: 'shipped:from-bo', kind: 'shipped', at: at('17:00'), title: 'Closed the issue' }, SHIPPED] }), on())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      day: DAY, hash: dayHash(stored().items), refused: [],
      results: [{ key: 'shipped:from-bo', status: 'added' }, { key: SHIPPED.key, status: 'present' }],
    })
    expect(stored().items['shipped:from-bo'].by).toEqual(['bo'])
  })

  it('items.POST names what a member removed, so the machine stops sending it', async () => {
    const { handlers } = await setup()
    await handlers.item.DELETE(send('DELETE', `/days/${DAY}/item${keyed(SHIPPED.key)}`), on())
    const res = await handlers.agent.items.POST(send('POST', `/agent/days/${DAY}/items`, { items: [SHIPPED] }), on())
    expect((await res.json()).refused).toEqual([SHIPPED.key])
  })

  it('items.POST refuses a body it cannot read and a call with too many items', async () => {
    const { handlers } = await setup()
    const broken = await handlers.agent.items.POST(new Request(url(`/agent/days/${DAY}/items`), { method: 'POST', body: '{not json' }), on())
    expect(broken.status).toBe(400)
    expect(await broken.json()).toEqual({ error: 'bad request' })
    const many = Array.from({ length: 61 }, (_, i) => ({ ...SHIPPED, key: `shipped:r${i}` }))
    expect((await handlers.agent.items.POST(send('POST', `/agent/days/${DAY}/items`, { items: many }), on())).status).toBe(400)
  })

  it('day.GET hands the writer the day and its hash', async () => {
    const { handlers, stored } = await setup()
    const res = await handlers.agent.day.GET(get(`/agent/days/${DAY}`), on())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ day: DAY, hash: dayHash(stored().items), account: null, accountStale: false, items: [{ key: 'messages:t1' }, { key: SHIPPED.key }] })
  })

  it('account.PUT sets the account, and answers 409 with the hash to read again from when the day has moved', async () => {
    const { handlers, stored, store, host } = await setup()
    const basedOn = dayHash(stored().items)
    const ok = await handlers.agent.account.PUT(send('PUT', `/agent/days/${DAY}/account`, { text: TEXT, basedOn }), on())
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ day: DAY, hash: basedOn, first: true })
    expect(host.announce.dayWritten).toHaveBeenCalledWith(DAY, 'ada')
    await store.contribute('bo', DAY, { items: [{ key: 'shipped:later', kind: 'shipped', at: at('18:00'), title: 'One more' }] })
    const stale = await handlers.agent.account.PUT(send('PUT', `/agent/days/${DAY}/account`, { text: 'A second telling.', basedOn }), on())
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'the day changed since it was read', hash: dayHash(stored().items) })
    expect(stored().account?.text).toBe(TEXT)
  })
})

describe('what goes wrong inside is never shown', () => {
  it('answers an unexpected error as an opaque 500', async () => {
    const { host, store } = await setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const handlers = createJourneyHandlers(host, { ...store, getDay: async () => { throw new Error('the database said something private') } })
    const res = await handlers.day.GET(get(`/days/${DAY}`), on())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'something went wrong' })
  })
})
