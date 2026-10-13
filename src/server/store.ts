import 'server-only'
import { RuleError, isRuleError } from '../errors.js'
import { setAccountOn, validateAccount, validateBasedOn } from '../account-rules.js'
import { dayHash } from '../day-hash.js'
import { assertTimeZone, localStamp, validateBefore, validateDay, validateLimit } from '../day-rules.js'
import { contributeTo, emptyDay, wantsMedia } from '../day.js'
import { checkBatch, itemMediaOf, validateKey } from '../item-rules.js'
import { removeFrom, removedOf, restoreIn } from '../removal.js'
import { agentDayOf, dayRow, dayView } from '../views.js'
import type {
  AgentDay, ContributeAnswer, ContributeResult, DayRecord, DayRow, DaysPage, DayView, ItemMedia, MediaRecord, NewItem, NewMedia, RemovedRow,
} from '../types.js'
import type { Destination, JourneyHost } from './host.js'

const nowIso = () => new Date().toISOString()

// A host written without types, or with a part left out, would fail on a person's first tap; it
// fails here instead, when the app starts, naming what is wrong.
export function assertHostFits<M extends string>(host: JourneyHost<M>): void {
  assertTimeZone(host.timeZone)
  const wrong: string[] = []
  const isFn = (v: unknown) => typeof v === 'function'
  const isText = (v: unknown) => typeof v === 'string' && v.length > 0
  if (!isText(host.collection)) wrong.push('collection')
  if (!isText(host.mediaCollection) || host.mediaCollection === host.collection) wrong.push('mediaCollection (a list of its own, not the days list)')
  for (const fn of ['signedUrl', 'filePhoto', 'fileVideo'] as const) if (!isFn(host.media?.[fn])) wrong.push(`media.${fn}()`)
  if (!isFn(host.announce?.dayWritten)) wrong.push('announce.dayWritten()')
  if (wrong.length) throw new Error(`journey: the host is missing ${wrong.join(', ')}`)
}

// Journey at the edge: read a day, call one rule, write the day, then tell the host. Every
// decision is in the root files (day.ts, removal.ts, account-rules.ts).
export function createJourneyStore<M extends string>(host: JourneyHost<M>) {
  assertHostFits(host)
  const days = () => host.db().collection(host.collection)
  const mediaDocs = () => host.db().collection(host.mediaCollection)
  const refusal = (err: unknown) => isRuleError(err) || host.isRefusal?.(err) === true
  const failed = (what: string, err: unknown) => { try { host.log?.(`journey: ${what} failed`, err) } catch { /* a log that throws is dropped too */ } }
  // A hook that is not waited for: the write is saved, so its failure must never become the answer.
  const quietly = (what: string, run: () => unknown) => {
    try {
      const r = run() as { then?: unknown } | undefined
      if (r && typeof r.then === 'function') (r as Promise<unknown>).then(undefined, (err) => failed(what, err))
    } catch (err) { failed(what, err) }
  }
  // A hook that IS waited for, and still never becomes the answer.
  const settle = async (what: string, run: () => unknown): Promise<void> => {
    try { await run() } catch (err) { failed(what, err) }
  }

  // One item's upload, handed to the app's own pipeline. The record it files lives in the media
  // collection under the upload's id and says which item it was filed for, so a resend whose first
  // answer was lost finds it there instead of asking the pipeline to claim a spent ticket.
  async function fileMedia(m: M, day: string, item: NewItem, media: NewMedia): Promise<ItemMedia> {
    const ref = mediaDocs().doc(media.uploadId)
    const had = await ref.get()
    let rec: MediaRecord<M>
    if (had.exists) {
      rec = had.data() as MediaRecord<M>
      if (rec.ofDay !== day || rec.ofKey !== item.key || rec.by !== m) throw new RuleError('that upload is already filed as something else', 409)
    } else {
      const into: Destination<M> = { ref, record: (filed) => ({ ...filed, ofDay: day, ofKey: item.key, by: m, createdAt: nowIso() }) }
      const stamp = localStamp(item.at, host.timeZone)
      rec = media.kind === 'photo'
        ? await host.media.filePhoto(m, media.uploadId, stamp, into)
        : await host.media.fileVideo(m, media.uploadId, { durationSec: media.durationSec!, width: media.width!, height: media.height!, takenAt: stamp }, into)
    }
    if (rec.kind !== media.kind) throw new RuleError(`that upload is a ${rec.kind}, not a ${media.kind}`, 400)
    return itemMediaOf(media.uploadId, rec)
  }

  /**
   * One machine's items for one day. Called again and again with only what is new, and safe to
   * call with what was already sent: a key the day has is `present`, the same call from the other
   * machine is `merged`, a key a member removed is `refused` for good and listed in `refused`, and
   * an item that could not be kept this time is `failed` with a reason and may be sent again.
   */
  async function contribute(m: M, dayRaw: unknown, body: unknown): Promise<ContributeAnswer> {
    const day = validateDay(dayRaw)
    const checked = checkBatch(body, day, host.timeZone)
    const ref = days().doc(day)

    // Uploads are filed before the day is written, outside the transaction: the app's pipeline
    // downloads and resizes. If two machines race here, the loser's upload is filed and pointed to
    // by nothing, which costs storage and shows nowhere.
    const seen = await ref.get()
    const before = seen.exists ? (seen.data() as DayRecord<M>) : emptyDay<M>(day, nowIso())
    const filedAt: (ItemMedia | undefined)[] = []
    const whyAt: (string | undefined)[] = []
    for (const [i, c] of checked.entries()) {
      if (!c.item) { whyAt[i] = c.reason ?? 'refused'; continue }
      if (!c.item.media || !wantsMedia(before, c.item)) continue
      try {
        filedAt[i] = await fileMedia(m, day, c.item, c.item.media)
      } catch (err) {
        if (!refusal(err)) throw err
        whyAt[i] = (err as Error).message
      }
    }

    const now = nowIso()
    const out = await host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      let rec = doc.exists ? (doc.data() as DayRecord<M>) : emptyDay<M>(day, now)
      const results: ContributeResult[] = []
      const touched: { key: string; narrowed: boolean }[] = []
      for (const [i, c] of checked.entries()) {
        if (!c.item || whyAt[i] !== undefined) { results.push({ key: c.key, status: 'failed', reason: whyAt[i] ?? 'refused' }); continue }
        const step = contributeTo(rec, m, c.item, filedAt[i], now)
        rec = step.rec
        results.push(step.result)
        if (step.changed) touched.push({ key: step.changed, narrowed: step.narrowed })
      }
      if (touched.length) tx.set(ref, { ...rec })
      return { results, touched, hash: dayHash(rec.items) }
    })

    for (const t of out.touched) {
      if (t.narrowed) await settle('forget item', () => host.forget?.item(day, t.key))
      quietly('index item', () => host.index?.item(day, t.key))
    }
    return { day, hash: out.hash, results: out.results, refused: out.results.filter((r) => r.status === 'refused').map((r) => r.key) }
  }

  /**
   * Either member removes any item. The item is hidden, never deleted, and search has forgotten it
   * by the time this answers. Removing what is already removed changes nothing and asks search to
   * forget again, so a forget that failed the first time gets a second try.
   */
  async function remove(m: M, dayRaw: unknown, keyRaw: unknown): Promise<{ day: string; key: string; removedCount: number }> {
    const day = validateDay(dayRaw)
    const key = validateKey(keyRaw)
    const ref = days().doc(day)
    const now = nowIso()
    const out = await host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new RuleError('no such day', 404)
      const step = removeFrom(doc.data() as DayRecord<M>, m, key, now)
      if (step.changed) tx.set(ref, { ...step.rec })
      return { key: step.key, hadAccount: step.hadAccount, removedCount: removedOf(step.rec).length }
    })
    await settle('forget item', () => host.forget?.item(day, out.key))
    if (out.hadAccount) await settle('forget day', () => host.forget?.day?.(day))
    return { day, key: out.key, removedCount: out.removedCount }
  }

  /** Either member puts a removed item back. `m` is who asked; nothing is recorded about a restore. */
  async function restore(m: M, dayRaw: unknown, keyRaw: unknown): Promise<{ day: string; key: string; removedCount: number }> {
    void m
    const day = validateDay(dayRaw)
    const key = validateKey(keyRaw)
    const ref = days().doc(day)
    const now = nowIso()
    const out = await host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new RuleError('no such day', 404)
      const step = restoreIn(doc.data() as DayRecord<M>, key, now)
      if (step.changed) tx.set(ref, { ...step.rec })
      return { key: step.key, changed: step.changed, removedCount: removedOf(step.rec).length }
    })
    if (out.changed) quietly('index item', () => host.index?.item(day, out.key))
    return { day, key: out.key, removedCount: out.removedCount }
  }

  /** What was removed from a day: its key, its kind, its title when it has one, who and when. */
  async function removed(dayRaw: unknown): Promise<RemovedRow<M>[]> {
    const day = validateDay(dayRaw)
    const doc = await days().doc(day).get()
    if (!doc.exists) throw new RuleError('no such day', 404)
    return removedOf(doc.data() as DayRecord<M>)
  }

  /**
   * Sets a day's account. `basedOn` is the hash the writer read the day with; if the day has
   * moved since, the answer is a 409 carrying the hash to read again from. The first account a day
   * ever gets is the one moment anyone is told. Two machines writing the same day at once are put
   * in order by the transaction, so exactly one of them is the first.
   */
  async function setAccount(m: M, dayRaw: unknown, body: unknown): Promise<{ day: string; hash: string; first: boolean }> {
    const day = validateDay(dayRaw)
    const b = (typeof body === 'object' && body !== null ? body : {}) as { text?: unknown; basedOn?: unknown }
    const text = validateAccount(b.text)
    const basedOn = validateBasedOn(b.basedOn)
    const ref = days().doc(day)
    const now = nowIso()
    const out = await host.db().runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      if (!doc.exists) throw new RuleError('no such day', 404)
      const step = setAccountOn(doc.data() as DayRecord<M>, m, text, basedOn, now)
      tx.set(ref, { ...step.rec })
      return { first: step.first, hash: basedOn }
    })
    quietly('index day', () => host.index?.day(day))
    if (out.first) quietly('announce dayWritten', () => host.announce.dayWritten(day, m))
    return { day, hash: out.hash, first: out.first }
  }

  const sign = (path: string) => host.media.signedUrl(path)

  /**
   * Days, newest first. One read of `limit + 1` records ordered by the date each record carries:
   * the extra one only says whether there is another page. A day with nothing left on it is not a
   * row, but it still moves the cursor, so paging never stalls on it.
   */
  async function listDays(opts: { before?: unknown; limit?: unknown } = {}): Promise<DaysPage> {
    const before = validateBefore(opts.before)
    const limit = validateLimit(opts.limit)
    const from = before ? days().where('day', '<', before) : days()
    const docs = (await from.orderBy('day', 'desc').limit(limit + 1).get()).docs.map((d) => d.data() as DayRecord<M>)
    const page = docs.slice(0, limit)
    const rows = await Promise.all(page.map((rec) => dayRow(rec, sign)))
    return { days: rows.filter((r): r is DayRow => r !== null), next: docs.length > limit ? page[page.length - 1].day : null }
  }

  /** One day as a member's page draws it, or null when nothing was ever contributed to it. */
  async function getDay(dayRaw: unknown): Promise<DayView<M> | null> {
    const day = validateDay(dayRaw)
    const doc = await days().doc(day).get()
    return doc.exists ? dayView(doc.data() as DayRecord<M>, sign) : null
  }

  /** One day as the session that writes its account reads it. Either member's key reads the whole day. */
  async function agentDay(dayRaw: unknown): Promise<AgentDay<M>> {
    const day = validateDay(dayRaw)
    const doc = await days().doc(day).get()
    return agentDayOf(day, doc.exists ? (doc.data() as DayRecord<M>) : null)
  }

  return { contribute, remove, restore, removed, setAccount, listDays, getDay, agentDay }
}

export type JourneyStore<M extends string> = ReturnType<typeof createJourneyStore<M>>
