import { describe, expect, it } from 'vitest'
import { formatDay, formatWhen } from './format-day.js'

const NOW = new Date('2026-10-13T09:00:00Z')

describe('formatDay', () => {
  it('names a day the way a person says it', () => {
    expect(formatDay('2026-10-12', NOW)).toBe('Monday, October 12')
  })

  it('adds the year when it is not this one', () => {
    expect(formatDay('2025-12-31', NOW)).toBe('Wednesday, December 31, 2025')
  })

  it('hands back what it was given when that is not a day', () => {
    expect(formatDay('soon', NOW)).toBe('soon')
  })
})

describe('formatWhen', () => {
  it('prints a short date and time', () => {
    expect(formatWhen('2026-10-12T22:05:00.000Z', NOW)).toMatch(/^Oct 12, 10:05\sPM$/)
  })

  it('is empty for a time it cannot read', () => {
    expect(formatWhen('whenever', NOW)).toBe('')
  })
})
