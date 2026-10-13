// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dayHash } from '../day-hash.js'
import { createJourneyStore } from './store.js'
import { fakeHost, type M } from '../../test/support/fake-host.js'
import type { DayRecord } from '../types.js'

// One day holding one of everything that must never be read once removed: a call with a title, a
// summary and a recording; a call with others present and its one line; a text with words; a
// photo. Beside them, two items nobody removes, and an account that tells of all of it.
const DAY = '2026-10-12'
const at = (hhmm: string) => `2026-10-12T${hhmm}:00-05:00`
const SUMMARY = 'SUMMARY the quarterly numbers'
const LINE = 'LINE a client asked about pricing'
const WORDS = 'WORDS see you at the harbour'
const TITLE = 'TITLE Board call'
const ACCOUNT = 'ACCOUNT they talked numbers, then walked to the harbour.'
const CALL = { key: 'conversations:secret', kind: 'call', at: at('10:00'), title: TITLE, summary: SUMMARY, media: { uploadId: 'upload-secret-rec', kind: 'video', durationSec: 60, width: 1280, height: 720 } }
const CLIENT_CALL = { key: 'conversations:client', kind: 'call', at: at('11:00'), title: `${TITLE} two`, others: true, line: LINE }
const TEXT = { key: 'messages:secret', kind: 'text', at: at('12:00'), words: WORDS }
const PHOTO = { key: 'camera-roll:secret', kind: 'photo', at: at('13:00'), media: { uploadId: 'upload-secret-pic', kind: 'photo' } }
const CLIP = { key: 'camera-roll:secret-clip', kind: 'video', at: at('13:30'), media: { uploadId: 'upload-secret-clip', kind: 'video', durationSec: 12, width: 1280, height: 720 } }
const KEPT = { key: 'shipped:kept', kind: 'shipped', at: at('16:00'), title: 'Released 0.1.0' }
const KEPT_PHOTO = { key: 'camera-roll:kept', kind: 'photo', at: at('16:10'), media: { uploadId: 'upload-kept-pic', kind: 'photo' } }
const REMOVED = [CALL, CLIENT_CALL, TEXT, PHOTO, CLIP]
// Every path the stand-in pipeline files under holds its upload id, so these find any path string.
const MEDIA = ['upload-secret-rec', 'upload-secret-pic', 'upload-secret-clip']
const NEVER = [SUMMARY, LINE, WORDS, ...MEDIA]

async function setup() {
  const h = fakeHost()
  const store = createJourneyStore(h.host)
  const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
  await store.contribute('ada', DAY, { items: [...REMOVED, KEPT, KEPT_PHOTO] })
  await store.setAccount('ada', DAY, { text: ACCOUNT, basedOn: dayHash(stored().items) })
  return { ...h, store, stored }
}
type S = Awaited<ReturnType<typeof setup>>
const removeAll = async (s: S) => { for (const item of REMOVED) await s.store.remove('bo', DAY, item.key) }

const READS: [string, (s: S) => Promise<unknown>][] = [
  ['the member day (getDay)', (s) => s.store.getDay(DAY)],
  ['the days list, with its thumbnails and first line (listDays)', (s) => s.store.listDays()],
  ['the agent day (agentDay)', (s) => s.store.agentDay(DAY)],
  ['the removed list (removed)', (s) => s.store.removed(DAY)],
  ['what search may hold (searchDay)', (s) => s.store.searchDay(DAY)],
  ['a contribute answer, with its hash', (s) => s.store.contribute('ada', DAY, { items: [...REMOVED, KEPT] })],
]

describe('before anything is removed, the reads do carry these words and paths', () => {
  it('so the tests below are looking for something that can be found', async () => {
    const s = await setup()
    const day = JSON.stringify(await s.store.getDay(DAY))
    for (const secret of [...NEVER, TITLE, ACCOUNT]) expect(day).toContain(secret)
    const agent = JSON.stringify(await s.store.agentDay(DAY))
    for (const secret of [SUMMARY, LINE, WORDS, TITLE, ACCOUNT]) expect(agent).toContain(secret)
    const search = JSON.stringify(await s.store.searchDay(DAY))
    for (const secret of [SUMMARY, LINE, WORDS, TITLE, ACCOUNT, 'upload-secret-pic', 'upload-secret-clip']) expect(search).toContain(secret)
    const list = JSON.stringify(await s.store.listDays())
    for (const secret of ['upload-secret-pic', 'upload-secret-clip', 'ACCOUNT they talked numbers']) expect(list).toContain(secret)
  })
})

describe('nothing of a removed item is in any read', () => {
  it.each(READS)('%s holds no removed summary, line, words or media path', async (name, read) => {
    const s = await setup()
    await removeAll(s)
    const out = JSON.stringify(await read(s))
    for (const secret of NEVER) expect(out, `${name} leaked ${secret}`).not.toContain(secret)
    // Only the removed list may name a removed item, and then by its title and kind alone.
    if (name.startsWith('the removed list')) {
      expect(JSON.parse(out).map((r: object) => Object.keys(r).sort())).toEqual(expect.arrayContaining([['at', 'by', 'key', 'kind', 'title'], ['at', 'by', 'key', 'kind']]))
      expect(out).toContain(TITLE)
    } else if (!name.startsWith('a contribute answer')) {
      expect(out, `${name} leaked a removed title`).not.toContain(TITLE)
      for (const item of REMOVED) expect(out, `${name} leaked the key ${item.key}`).not.toContain(item.key)
    }
  })

  it('the hash is the hash of what is left, whatever the removed items held', async () => {
    const s = await setup()
    await removeAll(s)
    const left = await s.store.agentDay(DAY)
    const t = fakeHost()
    const other = createJourneyStore(t.host)
    await other.contribute('ada', DAY, { items: [KEPT, KEPT_PHOTO] })
    expect(left.hash).toBe((await other.agentDay(DAY)).hash)
    expect(left.hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('the pages still hold what nobody removed', async () => {
    const s = await setup()
    await removeAll(s)
    const out = JSON.stringify([await s.store.getDay(DAY), await s.store.agentDay(DAY), await s.store.searchDay(DAY), await s.store.listDays()])
    expect(out).toContain('Released 0.1.0')
    expect(out).toContain('upload-kept-pic')
  })
})

describe('nothing of a withheld account is in any read', () => {
  it.each(READS)('%s holds none of its text', async (_name, read) => {
    const s = await setup()
    await s.store.remove('bo', DAY, TEXT.key)
    expect(s.stored().accountWithheld).toBe(true)
    expect(JSON.stringify(await read(s))).not.toContain('ACCOUNT')
  })

  it('an account withheld by a narrowing merge is in none either', async () => {
    const h = fakeHost()
    const store = createJourneyStore(h.host)
    const stored = () => h.f.raw('journey', DAY) as unknown as DayRecord<M>
    const call = { key: 'conversations:a1', kind: 'call', at: at('10:00'), title: TITLE, summary: SUMMARY, meetingKey: 'mk-1' }
    await store.contribute('ada', DAY, { items: [call, KEPT] })
    await store.setAccount('ada', DAY, { text: ACCOUNT, basedOn: dayHash(stored().items) })
    await store.contribute('bo', DAY, { items: [{ key: 'conversations:b7', kind: 'call', at: at('10:00'), title: TITLE, meetingKey: 'mk-1', others: true, line: 'They joined late.' }] })
    const s = { ...h, store, stored } as S
    for (const [name, read] of READS) {
      const out = JSON.stringify(await read(s))
      expect(out, `${name} leaked the account`).not.toContain('ACCOUNT')
      expect(out, `${name} leaked the stripped summary`).not.toContain(SUMMARY)
    }
  })
})
