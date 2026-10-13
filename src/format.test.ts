import { describe, expect, it } from 'vitest'
import { formatDay, formatWhen, fromLine } from './format.js'

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

  it('names the same day whatever zone the reader is in', () => {
    const had = process.env.TZ
    try {
      for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
        process.env.TZ = zone
        expect(formatDay('2026-10-12', NOW), zone).toBe('Monday, October 12')
      }
    } finally { process.env.TZ = had }
  })
})

// The zone is passed in, so these read the same on any machine, whatever its own zone is.
describe('formatWhen', () => {
  it('prints a short date and time in the zone it is given', () => {
    expect(formatWhen('2026-10-12T22:05:00.000Z', NOW, 'UTC')).toMatch(/^Oct 12, 10:05\sPM$/)
    expect(formatWhen('2026-10-12T22:05:00.000Z', NOW, 'America/Chicago')).toMatch(/^Oct 12, 5:05\sPM$/)
    expect(formatWhen('2026-10-12T22:05:00.000Z', NOW, 'Asia/Tokyo')).toMatch(/^Oct 13, 7:05\sAM$/)
  })

  it('adds the year when it is not this one, counted in that zone', () => {
    expect(formatWhen('2025-12-31T23:30:00.000Z', NOW, 'UTC')).toMatch(/^Dec 31, 2025, 11:30\sPM$/)
    expect(formatWhen('2025-12-31T23:30:00.000Z', new Date('2026-01-01T00:10:00Z'), 'Asia/Tokyo')).toMatch(/^Jan 1, 8:30\sAM$/)
  })

  it('with no zone it uses the reader own, which is what a screen wants', () => {
    expect(formatWhen('2026-10-12T22:05:00.000Z', NOW)).toMatch(/^Oct 1[23], \d{1,2}:\d{2}\s[AP]M$/)
  })

  it('is empty for a time it cannot read', () => {
    expect(formatWhen('whenever', NOW, 'UTC')).toBe('')
  })
})

describe('fromLine', () => {
  const NAMES = { ada: 'Ada', bo: 'Bo' }

  it('names whose machine an item came from', () => {
    expect(fromLine(['ada'], NAMES)).toBe('From Ada')
    expect(fromLine(['ada', 'bo'], NAMES)).toBe('From Ada and Bo')
    expect(fromLine(['cy'], NAMES)).toBe('From cy')
  })
})
