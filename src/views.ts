import { accountStale, firstLineOf } from './account-rules.js'
import { dayHash } from './day-hash.js'
import { removedOf, visibleOf } from './removal.js'
import type {
  AgentDay, AgentItem, DayGroup, DayRecord, DayRow, DayView, GroupName, Item, ItemKind, ItemMedia, ItemView, MediaView, SearchDay, SearchItem,
} from './types.js'

/** How the host turns a stored path into a short-lived read URL. */
export type Sign = (path: string) => Promise<string>

// The order a day page reads in: what was said, what was seen, what was written, what shipped.
export const GROUP_ORDER: readonly { name: GroupName; kinds: readonly ItemKind[] }[] = [
  { name: 'calls', kinds: ['call'] },
  { name: 'media', kinds: ['photo', 'video'] },
  { name: 'texts', kinds: ['text'] },
  { name: 'shipped', kinds: ['shipped'] },
]
export const THUMBS_PER_DAY = 4

export async function mediaView(media: ItemMedia, sign: Sign): Promise<MediaView> {
  const [thumbUrl, displayUrl, videoUrl] = await Promise.all([
    media.thumbPath ? sign(media.thumbPath) : Promise.resolve(null),
    media.displayPath ? sign(media.displayPath) : Promise.resolve(null),
    media.videoPath ? sign(media.videoPath) : Promise.resolve(undefined),
  ])
  return {
    kind: media.kind, width: media.width, height: media.height, thumbUrl, displayUrl,
    ...(videoUrl ? { videoUrl } : {}),
    ...(media.durationSec !== undefined ? { durationSec: media.durationSec } : {}),
  }
}

export async function itemView<M extends string>(item: Item<M>, sign: Sign): Promise<ItemView<M>> {
  // One set of notes per contributor, in the order they contributed.
  const summaries = item.by.flatMap((m) => {
    const text = item.summaries?.[m]
    return text ? [{ by: m, text }] : []
  })
  return {
    key: item.key, kind: item.kind, at: item.at, by: item.by,
    ...(item.title ? { title: item.title } : {}),
    ...(item.line ? { line: item.line } : {}),
    summaries,
    ...(item.words ? { words: item.words } : {}),
    ...(item.others ? { others: true as const } : {}),
    ...(item.media ? { media: await mediaView(item.media, sign) } : {}),
  }
}

/**
 * One day as a member's page draws it. Removed items are in no group; only their number is here.
 * An account written before an item was removed is withheld until it is written again.
 */
export async function dayView<M extends string>(rec: DayRecord<M>, sign: Sign): Promise<DayView<M>> {
  const visible = visibleOf(rec)
  const groups: DayGroup<M>[] = await Promise.all(GROUP_ORDER.map(async (g) => ({
    name: g.name,
    items: await Promise.all(visible.filter((i) => g.kinds.includes(i.kind)).map((i) => itemView(i, sign))),
  })))
  const shown = rec.account && !rec.accountWithheld && visible.length > 0 ? rec.account : null
  return {
    day: rec.day,
    account: shown ? { text: shown.text, by: shown.by, at: shown.at } : null,
    accountPending: rec.account !== undefined && shown === null,
    groups,
    removedCount: removedOf(rec).length,
  }
}

/** One day in the list, or null when nothing on it is visible. */
export async function dayRow<M extends string>(rec: DayRecord<M>, sign: Sign): Promise<DayRow | null> {
  const visible = visibleOf(rec)
  if (visible.length === 0) return null
  const paths = visible.flatMap((i) => (i.media?.thumbPath ? [i.media.thumbPath] : [])).slice(0, THUMBS_PER_DAY)
  return {
    day: rec.day,
    firstLine: rec.account && !rec.accountWithheld ? firstLineOf(rec.account.text) : null,
    thumbs: await Promise.all(paths.map((p) => sign(p))),
    count: visible.length,
  }
}

/**
 * One day as the session that writes its account needs it: every visible item's words and facts,
 * whether it carries media (never where), the hash to send back as `basedOn`, the account if there
 * is one to build on, whether it is owed a rewrite, and the zone the day is counted in. An account
 * withheld after a removal is not handed back, so the next telling cannot carry forward what was
 * pulled.
 */
export function agentDayOf<M extends string>(day: string, rec: DayRecord<M> | null, timeZone: string): AgentDay<M> {
  if (!rec) return { day, timeZone, hash: dayHash({}), account: null, accountStale: false, items: [] }
  const items = visibleOf(rec).map((i): AgentItem<M> => ({
    key: i.key,
    ...(i.aka ? { aka: i.aka } : {}),
    kind: i.kind, at: i.at, by: i.by,
    ...(i.title ? { title: i.title } : {}),
    ...(i.line ? { line: i.line } : {}),
    ...(i.summaries ? { summaries: i.summaries } : {}),
    ...(i.words ? { words: i.words } : {}),
    ...(i.others ? { others: true as const } : {}),
    ...(i.meetingKey ? { meetingKey: i.meetingKey } : {}),
    hasMedia: i.media !== undefined,
    ...(i.media ? { mediaKind: i.media.kind } : {}),
  }))
  const a = rec.account && !rec.accountWithheld ? rec.account : null
  return {
    day,
    timeZone,
    hash: dayHash(rec.items),
    account: a ? { text: a.text, by: a.by, at: a.at, basedOn: a.basedOn } : null,
    accountStale: accountStale(rec),
    items,
  }
}

/**
 * One day as a search index may hold it, or null for no day. The one read an indexer should use:
 * it starts from what is visible, then leaves out every item search still owes a forget for, so
 * an index built from it can never hold what a removal or a narrowing took away. The account is
 * here only when it is shown to members and owes no forget.
 */
export function searchDayOf<M extends string>(rec: DayRecord<M> | null): SearchDay<M> | null {
  if (!rec) return null
  const items = visibleOf(rec).filter((i) => i.owesForget === undefined).map((i): SearchItem<M> => ({
    key: i.key, kind: i.kind, at: i.at, by: i.by,
    ...(i.title ? { title: i.title } : {}),
    ...(i.line ? { line: i.line } : {}),
    ...(i.summaries ? { summaries: i.summaries } : {}),
    ...(i.words ? { words: i.words } : {}),
    ...(i.media?.thumbPath ? { thumbPath: i.media.thumbPath } : {}),
  }))
  const shown = rec.account && !rec.accountWithheld && rec.accountOwesForget === undefined && items.length > 0
  return { day: rec.day, items, ...(shown ? { account: rec.account!.text } : {}) }
}
