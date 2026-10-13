import { RuleError } from './errors.js'

// A day is a calendar date in the host's one time zone, written YYYY-MM-DD. It is the id of the
// record everything contributed for that date lands in.
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function validateDay(v: unknown): string {
  const m = typeof v === 'string' ? DAY_RE.exec(v) : null
  if (!m) throw new RuleError('day must be YYYY-MM-DD', 400)
  const [y, mo, d] = m.slice(1).map(Number)
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new RuleError('day must be a real date', 400)
  return v as string
}

// An instant: a date, a time, and an offset (Z, or hours and minutes). A time with no offset would
// land on different days on two machines, so it is refused. Answered as the same instant in UTC.
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

export function validateAt(v: unknown): string {
  const text = typeof v === 'string' ? v.trim() : ''
  const t = INSTANT_RE.test(text) ? new Date(text) : null
  if (!t || Number.isNaN(t.getTime())) {
    throw new RuleError('at must be a time with an offset, for example 2031-04-05T10:04:00-05:00 or 2031-04-05T15:04:00Z', 400)
  }
  return t.toISOString()
}

function partsIn(at: string | Date, timeZone: string, withTime: boolean): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit' as const, minute: '2-digit' as const, second: '2-digit' as const, hourCycle: 'h23' as const } : {}),
  })
  return Object.fromEntries(fmt.formatToParts(new Date(at)).map((p) => [p.type, p.value]))
}

/** The calendar day an instant falls on in one named zone. */
export function dayIn(at: string | Date, timeZone: string): string {
  const p = partsIn(at, timeZone, false)
  return `${p.year}-${p.month}-${p.day}`
}

/** The wall clock an instant reads in one named zone, with no offset: the form a camera stamps. */
export function localStamp(at: string | Date, timeZone: string): string {
  const p = partsIn(at, timeZone, true)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

/** A host bug, so a plain Error: the app fails when it starts instead of on a person's first tap. */
export function assertTimeZone(timeZone: unknown): string {
  try {
    if (typeof timeZone !== 'string' || !timeZone) throw new Error('empty')
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    throw new Error(`journey: ${String(timeZone)} is not a time zone`)
  }
}

export const DAYS_PAGE_DEFAULT = 20
export const DAYS_PAGE_MAX = 50

/** The list's cursor: the oldest day already shown, or nothing for the first page. */
export function validateBefore(v: unknown): string | undefined {
  return v === undefined || v === null || v === '' ? undefined : validateDay(v)
}

/** How many days one page holds. A URL hands it over as text. */
export function validateLimit(v: unknown): number {
  if (v === undefined || v === null || v === '') return DAYS_PAGE_DEFAULT
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > DAYS_PAGE_MAX) {
    throw new RuleError(`limit must be a whole number from 1 to ${DAYS_PAGE_MAX}`, 400)
  }
  return n
}
