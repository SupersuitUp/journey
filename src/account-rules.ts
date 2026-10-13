import { RuleError } from './errors.js'
import { dayHash } from './day-hash.js'
import { visibleOf } from './removal.js'
import type { DayRecord } from './types.js'

export const ACCOUNT_MAX = 6000
const HASH_RE = /^[0-9a-f]{16}$/
// A heading, a bullet, a block quote, bold, a code fence, a link. A lone dash or star inside a
// sentence is ordinary prose and passes.
const MARKDOWN_RE = /(^|\n)[ \t]{0,3}(#{1,6}[ \t]|[-*+][ \t]|>[ \t])|\*\*|```|\]\(/

/** The written account of a day: plain prose, in paragraphs. The page prints it exactly as it is. */
export function validateAccount(v: unknown): string {
  if (typeof v !== 'string') throw new RuleError('text must be text', 400)
  const t = v.replace(/\r\n?/g, '\n').trim()
  if (!t) throw new RuleError('text is empty', 400)
  if (t.length > ACCOUNT_MAX) throw new RuleError(`text is longer than ${ACCOUNT_MAX} characters`, 400)
  if (MARKDOWN_RE.test(t)) throw new RuleError('write the account as plain prose, with no markdown', 400)
  return t
}

export function validateBasedOn(v: unknown): string {
  if (typeof v !== 'string' || !HASH_RE.test(v)) throw new RuleError('basedOn must be the hash the day was read with', 400)
  return v
}

/** What a day shows in the list: the first line of its account that has words, cut to a length. */
export function firstLineOf(text: string, max = 160): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? ''
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/**
 * Sets a day's account. It must have been written from the day as it stands (`basedOn` is the
 * hash the writer read), so a machine that read an older day is told to read again instead of
 * overwriting with a telling that misses what arrived or still tells of what was removed.
 * `first` is true only the first time a day is ever written up: the one moment anyone is told.
 */
export function setAccountOn<M extends string>(rec: DayRecord<M>, m: M, text: string, basedOn: string, now: string): { rec: DayRecord<M>; first: boolean } {
  const hash = dayHash(rec.items)
  if (basedOn !== hash) throw new RuleError('the day changed since it was read', 409, { hash })
  if (visibleOf(rec).length === 0) throw new RuleError('nothing is left on this day to write about', 409, { hash })
  const first = rec.account === undefined
  const next: DayRecord<M> = { ...rec, account: { text, by: m, at: now, basedOn: hash, firstAt: rec.account?.firstAt ?? now }, updatedAt: now }
  delete next.accountStale
  delete next.accountWithheld
  return { rec: next, first }
}

/**
 * Whether the next run should write the day again: an item was removed or restored since the
 * account was written, or the day has changed in any other way since (something arrived).
 */
export function accountStale<M extends string>(rec: DayRecord<M>): boolean {
  if (rec.account === undefined) return false
  return rec.accountStale === true || rec.accountWithheld === true || rec.account.basedOn !== dayHash(rec.items)
}
