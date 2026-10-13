import 'server-only'
import { RuleError, isRuleError } from '../errors.js'
import { dayHash } from '../day-hash.js'
import { assertTimeZone, localStamp, validateDay } from '../day-rules.js'
import { contributeTo, emptyDay, wantsMedia } from '../day.js'
import { checkBatch, itemMediaOf } from '../item-rules.js'
import type { ContributeAnswer, ContributeResult, DayRecord, ItemMedia, MediaRecord, NewItem, NewMedia } from '../types.js'
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

  return { contribute }
}

export type JourneyStore<M extends string> = ReturnType<typeof createJourneyStore<M>>
