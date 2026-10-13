// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuleError } from '../errors.js'
import { handle } from './http.js'

class HostRefusal extends Error {
  constructor(message: string, public status?: number) { super(message) }
}
const isHostRefusal = (err: unknown) => err instanceof RuleError || err instanceof HostRefusal

describe('handle: every route answers in one shape', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('passes a good answer through', async () => {
    const res = await handle(async () => Response.json({ ok: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('answers a refusal with its own words and status', async () => {
    const res = await handle(async () => { throw new RuleError('no such day', 404) })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'no such day' })
  })

  it('puts what a refusal carries beside its words, and never lets it replace them', async () => {
    const res = await handle(async () => { throw new RuleError('the day changed since it was read', 409, { hash: 'abc', error: 'overwritten' }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'the day changed since it was read', hash: 'abc' })
  })

  it('answers a host refusal the host vouched for, 403 when it names no status', async () => {
    const named = await handle(async () => { throw new HostRefusal('upload not found or expired', 400) }, isHostRefusal)
    expect(named.status).toBe(400)
    expect(await named.json()).toEqual({ error: 'upload not found or expired' })
    const bare = await handle(async () => { throw new HostRefusal('not yours') }, isHostRefusal)
    expect(bare.status).toBe(403)
  })

  it('treats a refusal with a status that is not a client error as a bug', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handle(async () => { throw new HostRefusal('secret detail', 500) }, isHostRefusal)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'something went wrong' })
  })

  it('never shows an error just because it carries a 4xx status', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handle(async () => { throw new HostRefusal('secret detail', 404) })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'something went wrong' })
    expect(spy).toHaveBeenCalled()
  })

  it('answers a body it cannot read as a bad request', async () => {
    const res = await handle(async () => { JSON.parse('{nope'); return Response.json({}) })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad request' })
  })
})
