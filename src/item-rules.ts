import { RuleError, isRuleError } from './errors.js'
import { dayIn, validateAt } from './day-rules.js'
import type { FiledMedia, ItemKind, ItemMedia, NewItem, NewMedia } from './types.js'

export const ITEM_KINDS: readonly ItemKind[] = ['call', 'photo', 'video', 'text', 'shipped']
export const KEY_MAX = 300
export const TITLE_MAX = 200
export const LINE_MAX = 200
export const SUMMARY_MAX = 1200
export const WORDS_MAX = 600
export const ITEMS_PER_CALL = 60
// A day is one record, and a record has a size limit; this is far above any real day.
export const DAY_MAX_ITEMS = 300
// How many other keys one call answers to. Two machines make one; the rest is room for a source
// that renames its recordings, without letting a call's list of names grow for ever.
export const AKA_MAX = 8
export const VIDEO_MAX_DURATION_SEC = 21600

// A key is whatever its source calls the item, so it is taken nearly as it comes: spaces inside
// and letters of any script are fine. What is refused is what a record cannot hold as a field name
// or what would read as a different key once printed: nothing at all, more than 300 characters, a
// control character, a space at either end, half of a surrogate pair, and the `__name__` form the
// database keeps for itself.
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const EDGE_SPACE_RE = /^\s|\s$/
const RESERVED_RE = /^__[^]*__$/
const HALF_PAIR_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const MEETING_KEY_RE = /^[\x21-\x7e]{1,200}$/
const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/
export const KEY_RULE = `key must be 1 to ${KEY_MAX} characters, with no control characters, no space at either end, and not of the form __name__`

export function validateKey(v: unknown): string {
  // Two code units at most make one character, so a longer string is not counted out in full.
  const fits = typeof v === 'string' && v.length > 0 && v.length <= KEY_MAX * 2 && [...v].length <= KEY_MAX
  if (!fits || CONTROL_RE.test(v) || EDGE_SPACE_RE.test(v) || RESERVED_RE.test(v) || HALF_PAIR_RE.test(v)) throw new RuleError(KEY_RULE, 400)
  return v
}

// Text a person will read: trimmed, an empty one read as absent, held to its length.
function prose(v: unknown, name: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new RuleError(`${name} must be text`, 400)
  const t = v.replace(/\r\n?/g, '\n').trim()
  if (!t) return undefined
  if (t.length > max) throw new RuleError(`${name} is longer than ${max} characters`, 400)
  return t
}
const oneLine = (v: unknown, name: string, max: number) => prose(typeof v === 'string' ? v.replace(/\s+/g, ' ') : v, name, max)

const positiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

// The bytes went up on a ticket the app issued; this is only the id that ticket gave, and for a
// video what the machine measured. The app's own pipeline checks the upload itself.
export function validateMedia(v: unknown): NewMedia {
  const b = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  if (typeof b.uploadId !== 'string' || !UPLOAD_ID_RE.test(b.uploadId)) throw new RuleError('media.uploadId must be the id an upload ticket gave', 400)
  if (b.kind === 'photo') return { uploadId: b.uploadId, kind: 'photo' }
  if (b.kind !== 'video') throw new RuleError('media.kind must be photo or video', 400)
  const { durationSec, width, height } = b
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0 || durationSec > VIDEO_MAX_DURATION_SEC) {
    throw new RuleError(`media.durationSec must be more than 0 and at most ${VIDEO_MAX_DURATION_SEC}`, 400)
  }
  if (!positiveInt(width) || !positiveInt(height)) throw new RuleError('media.width and media.height must be positive whole numbers', 400)
  return { uploadId: b.uploadId, kind: 'video', durationSec, width, height }
}

// One contributed item, checked against the day it is sent to. Every refusal says what to fix.
export function validateItem(raw: unknown, day: string, timeZone: string): NewItem {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const key = validateKey(b.key)
  if (typeof b.kind !== 'string' || !(ITEM_KINDS as readonly string[]).includes(b.kind)) throw new RuleError('kind must be call, photo, video, text or shipped', 400)
  const kind = b.kind as ItemKind
  const at = validateAt(b.at)
  if (dayIn(at, timeZone) !== day) throw new RuleError(`at does not fall on ${day} in ${timeZone}`, 400)
  if (b.others !== undefined && typeof b.others !== 'boolean') throw new RuleError('others must be true or false', 400)
  const others = b.others === true
  if (others && kind !== 'call') throw new RuleError('others is only for a call', 400)

  const title = oneLine(b.title, 'title', TITLE_MAX)
  const line = oneLine(b.line, 'line', LINE_MAX)
  const summary = prose(b.summary, 'summary', SUMMARY_MAX)
  const words = prose(b.words, 'words', WORDS_MAX)
  let meetingKey: string | undefined
  if (b.meetingKey !== undefined && b.meetingKey !== null) {
    if (typeof b.meetingKey !== 'string' || !MEETING_KEY_RE.test(b.meetingKey)) throw new RuleError('meetingKey must be 1 to 200 characters with no spaces', 400)
    meetingKey = b.meetingKey
  }
  const media = b.media === undefined || b.media === null ? undefined : validateMedia(b.media)
  if (b.from !== undefined && b.from !== null && b.from !== 'me' && b.from !== 'other') throw new RuleError('from must be "me" or "other"', 400)
  const from = b.from === 'me' || b.from === 'other' ? b.from : undefined
  if (from && kind !== 'text') throw new RuleError('from is only for a text', 400)

  if (others && media) throw new RuleError('a call with other people present carries no recording', 400)
  if (others && summary) throw new RuleError('a call with other people present carries no summary, only a title and one line', 400)
  if (line && !others) throw new RuleError('line is only for a call with other people present', 400)
  if (summary && kind !== 'call') throw new RuleError('summary is only for a call', 400)
  if (words && kind !== 'text') throw new RuleError('words is only for a text', 400)
  if (meetingKey && kind !== 'call') throw new RuleError('meetingKey is only for a call', 400)
  if ((kind === 'call' || kind === 'shipped') && !title) throw new RuleError(`a ${kind} needs a title`, 400)
  if (kind === 'text' && !words) throw new RuleError('a text needs words', 400)
  if (kind === 'photo' || kind === 'video') {
    if (!media || media.kind !== kind) throw new RuleError(`a ${kind} needs its ${kind} upload`, 400)
  } else if (kind === 'call') {
    if (media && media.kind !== 'video') throw new RuleError('a call recording is a video', 400)
  } else if (media) {
    throw new RuleError(`a ${kind} item carries no media`, 400)
  }

  return {
    key, kind, at,
    ...(title ? { title } : {}),
    ...(line ? { line } : {}),
    ...(summary ? { summary } : {}),
    ...(words ? { words } : {}),
    ...(from ? { from } : {}),
    ...(others ? { others: true as const } : {}),
    ...(meetingKey ? { meetingKey } : {}),
    ...(media ? { media } : {}),
  }
}

export interface Checked { key: string; item: NewItem | null; reason?: string }

// One contribute call: a list of up to sixty items for one day, in the order they were sent. An
// item that cannot be kept is reported in its place and the rest still land, whatever is wrong
// with it: a broken rule, a key that is not one, or something that is not an item at all. Its key
// is handed back as it was given when it is text, and as an empty one otherwise.
export function checkBatch(body: unknown, day: string, timeZone: string): Checked[] {
  const list = (typeof body === 'object' && body !== null ? (body as { items?: unknown }).items : undefined)
  if (!Array.isArray(list)) throw new RuleError('items must be a list', 400)
  if (list.length > ITEMS_PER_CALL) throw new RuleError(`at most ${ITEMS_PER_CALL} items in one call`, 400)
  return list.map((raw): Checked => {
    const given = typeof raw === 'object' && raw !== null ? (raw as { key?: unknown }).key : undefined
    const key = typeof given === 'string' ? given : ''
    try {
      return { key, item: validateItem(raw, day, timeZone) }
    } catch (err) {
      if (isRuleError(err)) return { key, item: null, reason: err.message }
      throw err
    }
  })
}

/** What an item keeps of a filed upload. An empty path (a video with no poster) is read as none. */
export function itemMediaOf(uploadId: string, filed: FiledMedia): ItemMedia {
  return {
    id: uploadId, kind: filed.kind, width: filed.width, height: filed.height,
    thumbPath: filed.paths.thumb || null, displayPath: filed.paths.display || null,
    ...(filed.video ? { videoPath: filed.video.path, durationSec: filed.video.durationSec } : {}),
  }
}
