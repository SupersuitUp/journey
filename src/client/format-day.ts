// A day key (YYYY-MM-DD) the way a person says it. Read at noon UTC and printed in UTC, so the
// name of the day never slides with the phone's zone.
export function formatDay(day: string, now = new Date()): string {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  const sameYear = d.getUTCFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

// A moment as the reader's phone shows it. Computed on the client, because the server does not
// know the phone's zone.
export function formatWhen(at: string, now = new Date()): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' })
}
