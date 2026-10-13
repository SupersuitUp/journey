// Journey's records. `M` is the app's member key, stored in `by` and never renamed.
export type Member = string
export type MemberNames = Record<string, string>

export type ItemKind = 'call' | 'photo' | 'video' | 'text' | 'shipped'
export type MediaKind = 'photo' | 'video'
export type VideoContentType = 'video/mp4' | 'video/quicktime'

export interface VideoInfo { path: string; posterPath: string | null; durationSec: number; contentType: VideoContentType }

// What the app's upload pipeline produced for one upload, before it belongs to an item.
export interface FiledMedia {
  kind: MediaKind; takenAt: string; width: number; height: number
  paths: { original: string; display: string; thumb: string }
  video?: VideoInfo
}

// One filed upload, kept in the host's media collection under the upload's own id. `ofDay` and
// `ofKey` say which item it was filed for, so a resend whose first answer was lost finds it again.
export type MediaRecord<M extends string = string> = FiledMedia & { ofDay: string; ofKey: string; by: M; createdAt: string }

// The part of a filed upload an item keeps: where its files are, never a signed URL.
export interface ItemMedia {
  id: string; kind: MediaKind; width: number; height: number
  thumbPath: string | null; displayPath: string | null
  videoPath?: string; durationSec?: number
}

export interface Removal<M extends string = string> { by: M; at: string }

// One contribution to a day. `key` is its first contributor's stable identity for it and is unique
// on the day. `aka` holds another machine's key for the same call. `by` lists every member whose
// machine contributed it, first contributor first. `summaries` is a call's short summary, one per
// contributor. `others` (always true when present) marks a call where someone else was there: a
// title and one `line`, never a summary and never media. Nothing is ever deleted: `removed` hides.
// `owesForget` is set when search may still hold what this item no longer shows (it was removed,
// or it lost its summaries and recording), and stays until search confirms it has forgotten. Its
// value is when the debt was taken, so a confirmation of an older debt never clears a newer one.
export interface Item<M extends string = string> {
  key: string
  aka?: string[]
  kind: ItemKind
  at: string
  by: M[]
  title?: string
  line?: string
  summaries?: Partial<Record<M, string>>
  words?: string
  others?: true
  meetingKey?: string
  media?: ItemMedia
  removed?: Removal<M>
  owesForget?: string
  addedAt: string
}

// The written account of a day. `basedOn` is the day's hash when it was written; `firstAt` is when
// the day was first written up, which is the one moment anyone is told.
export interface Account<M extends string = string> { text: string; by: M; at: string; basedOn: string; firstAt: string }

// One document per day, id YYYY-MM-DD. `accountStale` (always true when present) is set when an
// item is removed or restored; `accountWithheld` (always true when present) is set when an item is
// removed, and hides the account until it is written again without that item.
// `accountOwesForget` is the account's own debt to search, kept the way an item's is.
export interface DayRecord<M extends string = string> {
  day: string
  items: Record<string, Item<M>>
  account?: Account<M>
  accountStale?: true
  accountWithheld?: true
  accountOwesForget?: string
  createdAt: string
  updatedAt: string
}

// What a machine sends for one item. `media.uploadId` is the id an upload ticket gave.
export interface NewMedia { uploadId: string; kind: MediaKind; durationSec?: number; width?: number; height?: number }
export interface NewItem {
  key: string; kind: ItemKind; at: string
  title?: string; line?: string; summary?: string; words?: string
  others?: true; meetingKey?: string; media?: NewMedia
}

// What happened to one contributed item, and so what its sender does next:
//   added, merged, present   it is on the day: keep the receipt and never send it again;
//   refused                  a member removed it: for good, so the sender forgets the key;
//   invalid                  it cannot be kept as it is (a broken rule, a full day, an upload that
//                            is missing or cannot be read): report it, and do not send it again as is;
//   failed                   something passing got in the way: send it again.
export type ContributeStatus = 'added' | 'merged' | 'present' | 'refused' | 'invalid' | 'failed'
/** What a rule decided for one key, before the call it came in gives it a place. */
export interface Outcome { key: string; status: ContributeStatus; reason?: string }
/** One row per item sent, in the order sent. `index` is its place in the call; `key` is empty when the item gave none. */
export interface ContributeResult extends Outcome { index: number }
export interface ContributeAnswer { day: string; hash: string; results: ContributeResult[]; refused: string[] }

// What a member's screen is handed. Media arrives as short-lived signed URLs.
export interface MediaView {
  kind: MediaKind; width: number; height: number
  thumbUrl: string | null; displayUrl: string | null
  videoUrl?: string; durationSec?: number
}
export interface ItemView<M extends string = string> {
  key: string; kind: ItemKind; at: string; by: M[]
  title?: string; line?: string
  summaries: { by: M; text: string }[]
  words?: string; others?: true; media?: MediaView
}
export type GroupName = 'calls' | 'media' | 'texts' | 'shipped'
export interface DayGroup<M extends string = string> { name: GroupName; items: ItemView<M>[] }
export interface DayView<M extends string = string> {
  day: string
  account: { text: string; by: M; at: string } | null
  /** An account exists and is hidden until it is written again (an item it drew on was removed). */
  accountPending: boolean
  groups: DayGroup<M>[]
  removedCount: number
}
export interface DayRow { day: string; firstLine: string | null; thumbs: string[]; count: number }
export interface DaysPage { days: DayRow[]; next: string | null }
export interface RemovedRow<M extends string = string> { key: string; kind: ItemKind; title?: string; by: M; at: string }

// What the session that writes the account is handed: words and facts, never a signed URL.
export interface AgentItem<M extends string = string> {
  key: string; aka?: string[]; kind: ItemKind; at: string; by: M[]
  title?: string; line?: string; summaries?: Partial<Record<M, string>>; words?: string
  others?: true; meetingKey?: string
  hasMedia: boolean; mediaKind?: MediaKind
}
export interface AgentDay<M extends string = string> {
  day: string
  hash: string
  account: { text: string; by: M; at: string; basedOn: string } | null
  accountStale: boolean
  items: AgentItem<M>[]
}
