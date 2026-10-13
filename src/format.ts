import type { MemberNames } from './types.js'

// How Journey says a day, a moment and a contributor. Plain functions over plain values, here in
// the root so an app can print the same words anywhere: a server page, a notification, an email.

// A day key (YYYY-MM-DD) the way a person says it. Read at noon UTC and printed in UTC, so the
// name of the day never slides with the reader's zone.
export function formatDay(day: string, now = new Date()): string {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  const sameYear = d.getUTCFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

// A moment as a reader's clock shows it. With no zone it is the zone of the machine it runs on,
// which on a screen is the reader's phone; a server passes the zone it means.
export function formatWhen(at: string, now = new Date(), timeZone?: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const yearOf = (x: Date) => x.toLocaleDateString('en-US', { timeZone, year: 'numeric' })
  const sameYear = yearOf(d) === yearOf(now)
  return d.toLocaleString('en-US', { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}

/** Whose machine an item came from, in the names the app gave. A member with no name is shown by key. */
export function fromLine(by: readonly string[], names: MemberNames): string {
  const who = by.map((m) => names[m] ?? m)
  return `From ${who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`}`
}
