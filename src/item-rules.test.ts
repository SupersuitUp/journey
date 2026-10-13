import { describe, expect, it } from 'vitest'
import { RuleError } from './errors.js'
import {
  ITEMS_PER_CALL, KEY_MAX, SUMMARY_MAX, TITLE_MAX, WORDS_MAX, checkBatch, itemMediaOf, validateItem, validateKey, validateMedia,
} from './item-rules.js'

const DAY = '2026-10-12'
const ZONE = 'America/Chicago'
const AT = '2026-10-12T10:00:00-05:00'
const ok = (raw: Record<string, unknown>) => validateItem({ at: AT, ...raw }, DAY, ZONE)
const refuses = (fn: () => unknown) => {
  try { fn() } catch (err) {
    expect(err).toBeInstanceOf(RuleError)
    expect((err as RuleError).status).toBe(400)
    return (err as RuleError).message
  }
  throw new Error('expected a refusal')
}
const VIDEO = { uploadId: 'upload-video-1', kind: 'video', durationSec: 62.5, width: 1920, height: 1080 }
const PHOTO = { uploadId: 'upload-photo-1', kind: 'photo' }

describe('validateKey', () => {
  it('accepts what a source makes: a name, a colon, an id or a path', () => {
    for (const key of ['conversations:abc123', 'shipped:repo/v1.2.3', 'camera-roll:8F2A/L0/001', 'messages:42', 'constructor']) expect(validateKey(key)).toBe(key)
  })

  it('accepts spaces inside, a leading mark, and letters of any script, up to 300 characters', () => {
    for (const key of ['notes:Weekly sync.md', '_x', ':x', 'réunion:été 2031', '会議:十月', 'a'.repeat(KEY_MAX), '😀'.repeat(KEY_MAX), '__x', 'x__']) expect(validateKey(key)).toBe(key)
  })

  it('refuses an empty key, a space at either end, a control character, a reserved name and a key that is too long', () => {
    for (const bad of ['', ' a', 'a ', '\ta', 'a\n', 'a\tb', 'a\u0000b', 'a\u007fb', '__x__', '____', 'a'.repeat(KEY_MAX + 1), 'a\ud800', 7, null, undefined, {}]) {
      expect(refuses(() => validateKey(bad))).toMatch(/key must be 1 to 300 characters/)
    }
  })
})

describe('validateMedia', () => {
  it('a photo is its upload id; a video also says how long and how large', () => {
    expect(validateMedia(PHOTO)).toEqual({ uploadId: 'upload-photo-1', kind: 'photo' })
    expect(validateMedia(VIDEO)).toEqual({ uploadId: 'upload-video-1', kind: 'video', durationSec: 62.5, width: 1920, height: 1080 })
  })

  it('refuses a missing id, another kind, and a video without its size', () => {
    refuses(() => validateMedia({ kind: 'photo' }))
    refuses(() => validateMedia({ uploadId: 'short', kind: 'photo' }))
    refuses(() => validateMedia({ uploadId: 'upload-audio-1', kind: 'audio' }))
    refuses(() => validateMedia({ ...VIDEO, durationSec: 0 }))
    refuses(() => validateMedia({ ...VIDEO, width: 0 }))
    refuses(() => validateMedia({ ...VIDEO, height: 1080.5 }))
    refuses(() => validateMedia('upload-photo-1'))
  })
})

describe('validateItem', () => {
  it('a call carries a title, and may carry a summary, a meeting key and its recording', () => {
    expect(ok({ key: 'conversations:c1', kind: 'call', title: 'Weekly sync', summary: 'They planned the week.', meetingKey: 'mk-1', media: VIDEO })).toEqual({
      key: 'conversations:c1', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Weekly sync',
      summary: 'They planned the week.', meetingKey: 'mk-1', media: validateMedia(VIDEO),
    })
    expect(refuses(() => ok({ key: 'conversations:c1', kind: 'call' }))).toMatch(/title/)
    expect(refuses(() => ok({ key: 'conversations:c1', kind: 'call', title: 'Sync', media: PHOTO }))).toMatch(/video/)
    expect(refuses(() => ok({ key: 'conversations:c1', kind: 'call', title: 'Sync', words: 'hello' }))).toMatch(/words/)
  })

  it('a call where someone else was present carries a title and one line, never a summary or a recording', () => {
    expect(ok({ key: 'conversations:c2', kind: 'call', title: 'Client call', line: 'Walked through the install.', others: true })).toEqual({
      key: 'conversations:c2', kind: 'call', at: '2026-10-12T15:00:00.000Z', title: 'Client call', line: 'Walked through the install.', others: true,
    })
    expect(refuses(() => ok({ key: 'conversations:c2', kind: 'call', title: 'Client call', others: true, summary: 'What the client said.' }))).toMatch(/summary/)
    expect(refuses(() => ok({ key: 'conversations:c2', kind: 'call', title: 'Client call', others: true, media: VIDEO }))).toMatch(/recording/)
    expect(refuses(() => ok({ key: 'conversations:c2', kind: 'call', title: 'Sync', line: 'One line.' }))).toMatch(/line/)
    expect(refuses(() => ok({ key: 'camera-roll:p1', kind: 'photo', media: PHOTO, others: true }))).toMatch(/others/)
    expect(refuses(() => ok({ key: 'conversations:c2', kind: 'call', title: 'Client call', others: 'yes' }))).toMatch(/others/)
  })

  it('others: false is the same as leaving it out', () => {
    expect(ok({ key: 'conversations:c1', kind: 'call', title: 'Sync', others: false })).not.toHaveProperty('others')
  })

  it('a photo and a video each need their own kind of upload', () => {
    expect(ok({ key: 'camera-roll:p1', kind: 'photo', media: PHOTO })).toEqual({ key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:00:00.000Z', media: PHOTO })
    expect(ok({ key: 'camera-roll:v1', kind: 'video', media: VIDEO, title: 'Whiteboard' }).title).toBe('Whiteboard')
    expect(refuses(() => ok({ key: 'camera-roll:p1', kind: 'photo' }))).toMatch(/upload/)
    expect(refuses(() => ok({ key: 'camera-roll:p1', kind: 'photo', media: VIDEO }))).toMatch(/upload/)
    expect(refuses(() => ok({ key: 'camera-roll:v1', kind: 'video', media: PHOTO }))).toMatch(/upload/)
  })

  it('a text needs its words and a shipped item its title, and neither carries media', () => {
    expect(ok({ key: 'messages:t1', kind: 'text', words: 'Shipping it today.' }).words).toBe('Shipping it today.')
    expect(ok({ key: 'shipped:r1', kind: 'shipped', title: 'Released 0.1.0' }).title).toBe('Released 0.1.0')
    expect(refuses(() => ok({ key: 'messages:t1', kind: 'text' }))).toMatch(/words/)
    expect(refuses(() => ok({ key: 'shipped:r1', kind: 'shipped' }))).toMatch(/title/)
    expect(refuses(() => ok({ key: 'messages:t1', kind: 'text', words: 'hi', media: PHOTO }))).toMatch(/media/)
    expect(refuses(() => ok({ key: 'shipped:r1', kind: 'shipped', title: 'Released', summary: 'More.' }))).toMatch(/summary/)
    expect(refuses(() => ok({ key: 'shipped:r1', kind: 'shipped', title: 'Released', meetingKey: 'mk-1' }))).toMatch(/meetingKey/)
  })

  it('refuses another kind, and a key it cannot keep', () => {
    expect(refuses(() => ok({ key: 'notes:n1', kind: 'note', title: 'x' }))).toMatch(/kind/)
    refuses(() => ok({ key: 'a ', kind: 'shipped', title: 'x' }))
  })

  it('holds each field to its length, and keeps a title to one line', () => {
    expect(ok({ key: 'shipped:r1', kind: 'shipped', title: '  Released \n 0.1.0  ' }).title).toBe('Released 0.1.0')
    expect(refuses(() => ok({ key: 'shipped:r1', kind: 'shipped', title: 'x'.repeat(TITLE_MAX + 1) }))).toMatch(/title/)
    expect(refuses(() => ok({ key: 'conversations:c1', kind: 'call', title: 'Sync', summary: 'x'.repeat(SUMMARY_MAX + 1) }))).toMatch(/summary/)
    expect(refuses(() => ok({ key: 'messages:t1', kind: 'text', words: 'x'.repeat(WORDS_MAX + 1) }))).toMatch(/words/)
    expect(ok({ key: 'conversations:c1', kind: 'call', title: 'Sync', summary: 'x'.repeat(SUMMARY_MAX) }).summary).toHaveLength(SUMMARY_MAX)
    expect(refuses(() => ok({ key: 'shipped:r1', kind: 'shipped', title: 42 }))).toMatch(/title/)
  })

  it('an item belongs to the day its time falls on in the host zone', () => {
    expect(ok({ key: 'messages:t1', kind: 'text', words: 'late', at: '2026-10-13T03:30:00Z' }).at).toBe('2026-10-13T03:30:00.000Z')
    expect(refuses(() => ok({ key: 'messages:t1', kind: 'text', words: 'next day', at: '2026-10-13T00:30:00-05:00' }))).toMatch(/does not fall on 2026-10-12/)
    expect(refuses(() => ok({ key: 'messages:t1', kind: 'text', words: 'no offset', at: '2026-10-12T10:00:00' }))).toMatch(/offset/)
  })
})

describe('checkBatch', () => {
  const good = { key: 'shipped:r1', kind: 'shipped', at: AT, title: 'Released 0.1.0' }

  it('wants a list of at most sixty items, and takes an empty one as nothing to do', () => {
    refuses(() => checkBatch(null, DAY, ZONE))
    refuses(() => checkBatch({ items: 'x' }, DAY, ZONE))
    refuses(() => checkBatch({}, DAY, ZONE))
    expect(checkBatch({ items: [] }, DAY, ZONE)).toEqual([])
    expect(refuses(() => checkBatch({ items: Array.from({ length: ITEMS_PER_CALL + 1 }, (_, i) => ({ ...good, key: `shipped:r${i}` })) }, DAY, ZONE))).toMatch(/60/)
    expect(checkBatch({ items: Array.from({ length: ITEMS_PER_CALL }, (_, i) => ({ ...good, key: `shipped:r${i}` })) }, DAY, ZONE)).toHaveLength(ITEMS_PER_CALL)
  })

  it('reports an item it cannot keep by its key, and keeps the rest', () => {
    const out = checkBatch({ items: [good, { key: 'messages:t1', kind: 'text', at: AT }] }, DAY, ZONE)
    expect(out[0]).toEqual({ key: 'shipped:r1', item: { key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T15:00:00.000Z', title: 'Released 0.1.0' } })
    expect(out[1]).toEqual({ key: 'messages:t1', item: null, reason: 'a text needs words' })
  })

  it('a key that breaks the rule fails that item only, and is handed back as it was given', () => {
    const out = checkBatch({ items: [{ ...good, key: ' padded' }, good, { ...good, key: '__name__' }] }, DAY, ZONE)
    expect(out.map((c) => [c.key, c.item === null])).toEqual([[' padded', true], ['shipped:r1', false], ['__name__', true]])
    expect(out[0].reason).toMatch(/key must be/)
  })

  it('an item with no key, a key that is not text, or that is not an item at all fails alone, under an empty key', () => {
    const out = checkBatch({ items: [{ kind: 'text', at: AT, words: 'hi' }, { ...good, key: 7 }, null, 'x', good] }, DAY, ZONE)
    expect(out.map((c) => [c.key, c.item === null])).toEqual([['', true], ['', true], ['', true], ['', true], ['shipped:r1', false]])
    for (const c of out.slice(0, 4)) expect(c.reason).toMatch(/key must be/)
  })
})

describe('itemMediaOf', () => {
  it('keeps where a photo files are', () => {
    expect(itemMediaOf('upload-photo-1', {
      kind: 'photo', takenAt: '2026-10-12T10:00:00', width: 3024, height: 4032,
      paths: { original: 'p/original/a.jpg', display: 'p/display/a.jpg', thumb: 'p/thumb/a.jpg' },
    })).toEqual({ id: 'upload-photo-1', kind: 'photo', width: 3024, height: 4032, thumbPath: 'p/thumb/a.jpg', displayPath: 'p/display/a.jpg' })
  })

  it('keeps a video file and its length, and reads an empty poster path as none', () => {
    expect(itemMediaOf('upload-video-1', {
      kind: 'video', takenAt: '2026-10-12T10:00:00', width: 1920, height: 1080,
      paths: { original: 'p/video/v.mp4', display: '', thumb: '' },
      video: { path: 'p/video/v.mp4', posterPath: null, durationSec: 62.5, contentType: 'video/mp4' },
    })).toEqual({ id: 'upload-video-1', kind: 'video', width: 1920, height: 1080, thumbPath: null, displayPath: null, videoPath: 'p/video/v.mp4', durationSec: 62.5 })
  })
})
