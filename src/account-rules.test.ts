import { describe, expect, it } from 'vitest'
import { RuleError } from './errors.js'
import { ACCOUNT_MAX, accountStale, firstLineOf, setAccountOn, validateAccount, validateBasedOn } from './account-rules.js'
import { contributeTo, emptyDay } from './day.js'
import { dayHash } from './day-hash.js'
import { removeFrom, restoreIn } from './removal.js'
import type { DayRecord } from './types.js'

type M = 'ada' | 'bo'
const DAY = '2026-10-12'
const NOW = '2026-10-12T16:00:00.000Z'
const LATER = '2026-10-13T09:00:00.000Z'
const LATEST = '2026-10-13T10:00:00.000Z'
const TEXT = 'Ada and Bo spent the morning on the release.\n\nBy the afternoon it was out.'

const shipped = (key: string) => ({ key, kind: 'shipped' as const, at: '2026-10-12T15:00:00.000Z', title: `Released ${key}` })
function day(): DayRecord<M> {
  let rec = emptyDay<M>(DAY, NOW)
  rec = contributeTo(rec, 'ada', shipped('shipped:r1'), undefined, NOW).rec
  rec = contributeTo(rec, 'bo', shipped('shipped:r2'), undefined, NOW).rec
  return rec
}
const refuses = (fn: () => unknown, status: number): RuleError => {
  try { fn() } catch (err) {
    expect(err).toBeInstanceOf(RuleError)
    expect((err as RuleError).status).toBe(status)
    return err as RuleError
  }
  throw new Error('expected a refusal')
}

describe('validateAccount', () => {
  it('keeps plain prose, trimmed, with its paragraphs', () => {
    expect(validateAccount(`  ${TEXT}\r\n`)).toBe(TEXT)
    expect(validateAccount('x'.repeat(ACCOUNT_MAX))).toHaveLength(ACCOUNT_MAX)
  })

  it('refuses nothing, too much, and anything that is not text', () => {
    refuses(() => validateAccount('   '), 400)
    refuses(() => validateAccount('x'.repeat(ACCOUNT_MAX + 1)), 400)
    refuses(() => validateAccount(undefined), 400)
    refuses(() => validateAccount(['a', 'b']), 400)
  })

  it('refuses markdown, since the page prints the account as it is', () => {
    for (const bad of ['# The day', 'They shipped.\n\n- one\n- two', 'They **shipped** it.', '> quoted', 'See [the release](https://example.test).', '```\ncode\n```']) {
      expect(refuses(() => validateAccount(bad), 400).message).toMatch(/plain prose/)
    }
    expect(validateAccount('They shipped 0.1.0 - the first release - at 3 * 2 in the afternoon.')).toContain('0.1.0')
  })
})

describe('validateBasedOn', () => {
  it('is the hash the day was read with', () => {
    expect(validateBasedOn(dayHash(day().items))).toMatch(/^[0-9a-f]{16}$/)
    for (const bad of ['', 'abc', 'Z'.repeat(16), 12, undefined]) refuses(() => validateBasedOn(bad), 400)
  })
})

describe('firstLineOf', () => {
  it('is the first line that has words', () => {
    expect(firstLineOf(TEXT)).toBe('Ada and Bo spent the morning on the release.')
    expect(firstLineOf('\n\n  Second.  \nThird.')).toBe('Second.')
    expect(firstLineOf('')).toBe('')
  })

  it('is cut to a length, with an ellipsis', () => {
    const out = firstLineOf('word '.repeat(60), 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('setAccountOn', () => {
  it('writes the account against the hash it was written from, and says it is the first', () => {
    const rec = day()
    const hash = dayHash(rec.items)
    const out = setAccountOn(rec, 'ada', TEXT, hash, LATER)
    expect(out.first).toBe(true)
    expect(out.rec.account).toEqual({ text: TEXT, by: 'ada', at: LATER, basedOn: hash, firstAt: LATER })
    expect(out.rec.updatedAt).toBe(LATER)
    expect(rec).not.toHaveProperty('account')
  })

  it('a rewrite is not the first, and keeps when the day was first written', () => {
    const rec = day()
    const hash = dayHash(rec.items)
    const once = setAccountOn(rec, 'ada', TEXT, hash, LATER)
    const twice = setAccountOn(once.rec, 'bo', 'A shorter telling.', hash, LATEST)
    expect(twice.first).toBe(false)
    expect(twice.rec.account).toEqual({ text: 'A shorter telling.', by: 'bo', at: LATEST, basedOn: hash, firstAt: LATER })
  })

  it('refuses an account written from a day that has since changed, and says what it is now', () => {
    const rec = day()
    const old = dayHash(rec.items)
    const grown = contributeTo(rec, 'bo', shipped('shipped:r3'), undefined, LATER).rec
    const err = refuses(() => setAccountOn(grown, 'ada', TEXT, old, LATEST), 409)
    expect(err.message).toBe('the day changed since it was read')
    expect(err.extra).toEqual({ hash: dayHash(grown.items) })
  })

  it('refuses to write up a day with nothing left on it', () => {
    let rec = removeFrom(day(), 'bo', 'shipped:r1', LATER).rec
    rec = removeFrom(rec, 'bo', 'shipped:r2', LATER).rec
    const err = refuses(() => setAccountOn(rec, 'ada', TEXT, dayHash(rec.items), LATEST), 409)
    expect(err.message).toMatch(/nothing is left/)
  })

  it('clears the stale and withheld marks a removal left', () => {
    const written = setAccountOn(day(), 'ada', TEXT, dayHash(day().items), LATER).rec
    const removed = removeFrom(written, 'bo', 'shipped:r2', LATER).rec
    expect(removed.accountWithheld).toBe(true)
    const again = setAccountOn(removed, 'ada', 'Ada shipped one release.', dayHash(removed.items), LATEST)
    expect(again.first).toBe(false)
    expect(again.rec).not.toHaveProperty('accountStale')
    expect(again.rec).not.toHaveProperty('accountWithheld')
  })
})

describe('accountStale', () => {
  const written = () => setAccountOn(day(), 'ada', TEXT, dayHash(day().items), LATER).rec

  it('is false for a day nobody wrote up, and for one written from what is there now', () => {
    expect(accountStale(day())).toBe(false)
    expect(accountStale(written())).toBe(false)
  })

  it('is true once something new arrives', () => {
    expect(accountStale(contributeTo(written(), 'bo', shipped('shipped:r3'), undefined, LATEST).rec)).toBe(true)
  })

  it('is true once an item is removed, and stays true when it is restored', () => {
    const removed = removeFrom(written(), 'bo', 'shipped:r2', LATEST).rec
    expect(accountStale(removed)).toBe(true)
    const restored = restoreIn(removed, 'shipped:r2', LATEST).rec
    expect(dayHash(restored.items)).toBe(restored.account?.basedOn)
    expect(accountStale(restored)).toBe(true)
  })
})
