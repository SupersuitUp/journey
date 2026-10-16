import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { FiledMedia, MediaRecord } from '../types.js'

// Where the app's upload pipeline files an upload: the record's reference, and how to build the
// record from what the pipeline produced.
export interface Destination<M extends string> {
  ref: DocumentReference
  record(media: FiledMedia): MediaRecord<M>
}

// Everything the app hands Journey. The module knows how a day works; the app says who the people
// are, where things are kept, how a file is uploaded, and what a contribution, a removal and a
// finished day become for search and for the other member.
export interface JourneyHost<M extends string> {
  /** Who is signed in for this request, or null for a stranger. The app enforces membership. */
  member(req?: Request): Promise<M | null>
  /** Called on use, never at import, so building an app needs no credentials. */
  db(): Firestore
  /** The list days are kept in: one record per day, its id the date (YYYY-MM-DD). */
  collection: string
  /** The list filed uploads are kept in: one record per upload, its id the upload's own id. Not `collection`. */
  mediaCollection: string
  /**
   * Every member, so a text a machine says the OTHER member wrote can be filed under them. Without
   * it, such a text is answered `invalid` and a text from the sending member still lands.
   */
  members?: readonly M[]
  /** The one zone a day is counted in, for everyone, for example 'America/Chicago'. */
  timeZone: string
  /**
   * Which of the app's OWN errors are refusals whose words go back to a caller. This package's own
   * RuleError is always a refusal; this check ADDS to that, so an error is never shown just because
   * it carries a 4xx status. Pass your upload pipeline's refusal check here: a refusal from
   * `media.filePhoto` or `media.fileVideo` then answers that one item `invalid` with the pipeline's
   * own words. Anything else the pipeline throws goes to `log` and answers that item `invalid`
   * with "that upload could not be read". Either way the rest of the batch still lands.
   */
  isRefusal?(err: unknown): boolean
  /** Where failures a caller must not see are reported, such as a hook that throws after the write was saved. */
  log?(message: string, err: unknown): void
  media: {
    /** A short-lived read URL for one stored file. */
    signedUrl(path: string): Promise<string>
    /**
     * The app's photo pipeline, filing an uploaded photo into `into`. `photoId` is the id the
     * ticket gave. The package relies on this pipeline to check that the upload was issued to `m`,
     * to claim it exactly once, and to refuse when `into.ref` already exists. `into.ref` is always
     * `<mediaCollection>/<photoId>`. Throw refusals as errors `isRefusal` recognises.
     */
    filePhoto(m: M, photoId: string, clientTakenAt: string | undefined, into: Destination<M>): Promise<MediaRecord<M>>
    /** The app's video pipeline. The same three duties as `filePhoto`. `takenAt` is local wall-clock time with no offset. */
    fileVideo(m: M, photoId: string, meta: { durationSec: number; width: number; height: number; takenAt?: string }, into: Destination<M>): Promise<MediaRecord<M>>
  }
  /**
   * Lets a machine contribute as exactly one member. The app vouches for a request with its own
   * agent key; the session is never consulted. Without this block every agent route answers 401.
   */
  agent?: {
    /** The member this request's agent key acts as, or null. Never the session. */
    member(req: Request): Promise<M | null>
    /** The app's own photo ticket, issued to `m`. */
    photoTicket(m: M): Promise<{ photoId: string; url: string; headers?: Record<string, string> }>
    /** The app's own video ticket, issued to `m`. */
    videoTicket(m: M, input: { contentType: unknown; size: unknown }): Promise<{ photoId: string; videoUrl: string; posterUrl: string; requiredHeaders: { video: Record<string, string>; poster: Record<string, string> } }>
  }
  /**
   * The one moment anyone is told: a day was written up for the first time, by `by`'s machine.
   * Called once per day, after the account is saved, and AWAITED before `setAccount` answers, so
   * a serverless host cannot drop it. A throw or rejection goes to `log` and never changes the
   * answer; the announcement is not retried, since the day is no longer the first.
   * Rewrites, contributions, removals and restores are quiet.
   */
  announce: {
    dayWritten(day: string, by: M): void | Promise<void>
  }
  /**
   * Search, adding. Called after the write is saved and NOT awaited: `item` after an item is
   * added, merged or restored, `day` after an account is set. The app reads the day back
   * (`store.searchDay(day)`) and indexes what it finds. A throw or rejection goes to `log` and has
   * no other effect, so back it with a pass of your own that indexes what a failed call missed.
   * Neither is ever called for an item or an account that still owes a forget: it is called once
   * that forget is confirmed.
   */
  index?: {
    item(day: string, key: string): void | Promise<void>
    day(day: string): void | Promise<void>
  }
  /**
   * Search, the other way. AWAITED before the request answers: `item` when an item is removed or
   * a call turns out to have had other people present, `day` when either of those happens on a
   * day that already had an account, since the account may tell of what was hidden or stripped.
   * Make both safe to call twice. The debt is written into the day by the same write, so a throw
   * or rejection (which goes to `log`) is not the end of it: the debt stays, and every later call
   * that writes that day asks again until search confirms. The caller is told as well: a removal
   * answers 409 with `removed: true` ("Removed. Search will catch up shortly.")
   * with the item still hidden, and a merge that narrowed a call reports that row `failed`.
   */
  forget?: {
    item(day: string, key: string): void | Promise<void>
    day?(day: string): void | Promise<void>
  }
}
