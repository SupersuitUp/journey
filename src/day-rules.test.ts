import { describe, expect, it } from 'vitest'
import { RuleError } from './errors.js'
import {
  DAYS_PAGE_DEFAULT, DAYS_PAGE_MAX, assertTimeZone, dayIn, localStamp, validateAt, validateBefore, validateDay, validateLimit,
} from './day-rules.js'

const refuses = (fn: () => unknown, status = 400) => {
  try { fn() } catch (err) {
    expect(err).toBeInstanceOf(RuleError)
    expect((err as RuleError).status).toBe(status)
    return (err as RuleError).message
  }
  throw new Error('expected a refusal')
}

describe('validateDay', () => {
  it('accepts a real calendar date', () => {
    expect(validateDay('2026-10-12')).toBe('2026-10-12')
    expect(validateDay('2028-02-29')).toBe('2028-02-29')
  })

  it('refuses anything else', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2026-1-5', '20261012', 'today', '', 20261012, null, undefined]) refuses(() => validateDay(bad))
  })
})

describe('validateAt', () => {
  it('accepts a time with an offset and answers the same instant in UTC', () => {
    expect(validateAt('2026-10-12T10:04:00-05:00')).toBe('2026-10-12T15:04:00.000Z')
    expect(validateAt('2026-10-12T15:04:00Z')).toBe('2026-10-12T15:04:00.000Z')
    expect(validateAt('2026-10-12T15:04:00.250Z')).toBe('2026-10-12T15:04:00.250Z')
    expect(validateAt(' 2026-10-12T15:04Z ')).toBe('2026-10-12T15:04:00.000Z')
  })

  it('refuses a time with no offset, because two machines would read it as two instants', () => {
    expect(refuses(() => validateAt('2026-10-12T10:04:00'))).toMatch(/offset/)
    refuses(() => validateAt('2026-10-12'))
    refuses(() => validateAt('2026-10-12T25:00:00Z'))
    refuses(() => validateAt(1760281440000))
    refuses(() => validateAt(undefined))
  })
})

describe('a day is counted in one named zone', () => {
  it('puts a late evening on the day it was lived', () => {
    expect(dayIn('2026-10-13T03:30:00.000Z', 'America/Chicago')).toBe('2026-10-12')
    expect(dayIn('2026-10-13T03:30:00.000Z', 'UTC')).toBe('2026-10-13')
    expect(dayIn(new Date('2026-10-12T05:00:00.000Z'), 'America/Chicago')).toBe('2026-10-12')
  })

  it('prints the wall clock of that zone with no offset', () => {
    expect(localStamp('2026-10-13T03:30:05.000Z', 'America/Chicago')).toBe('2026-10-12T22:30:05')
    expect(localStamp('2026-10-12T05:00:00.000Z', 'America/Chicago')).toBe('2026-10-12T00:00:00')
  })

  it('refuses a zone that is not one, when the app starts', () => {
    expect(assertTimeZone('America/Chicago')).toBe('America/Chicago')
    expect(() => assertTimeZone('Mars/Olympus')).toThrow(/not a time zone/)
    expect(() => assertTimeZone('')).toThrow(/not a time zone/)
    expect(() => assertTimeZone(undefined)).toThrow(/not a time zone/)
  })
})

describe('paging the list of days', () => {
  it('reads no cursor as the first page', () => {
    expect(validateBefore(undefined)).toBeUndefined()
    expect(validateBefore(null)).toBeUndefined()
    expect(validateBefore('')).toBeUndefined()
    expect(validateBefore('2026-10-12')).toBe('2026-10-12')
    refuses(() => validateBefore('yesterday'))
  })

  it('takes a page size from 1 to the cap, as a number or as the text a URL carries', () => {
    expect(validateLimit(undefined)).toBe(DAYS_PAGE_DEFAULT)
    expect(validateLimit('')).toBe(DAYS_PAGE_DEFAULT)
    expect(validateLimit('5')).toBe(5)
    expect(validateLimit(DAYS_PAGE_MAX)).toBe(DAYS_PAGE_MAX)
    for (const bad of [0, DAYS_PAGE_MAX + 1, 2.5, 'many', '-1', true]) refuses(() => validateLimit(bad))
  })
})
