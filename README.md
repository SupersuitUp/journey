# @supersuit/journey

Journey: a private timeline of days for the people who share an app. Each person's machine
contributes what arrived that day (calls, photos, video, a few texts, shipped work), an account of
the day is written from what is there, and anyone in the app can remove any item.

The package knows how the feature works: the record of a day, every rule (what each kind of item
must carry, what a call with other people present never does, when two machines sent the same
call, what a removal means), reading and writing days, the request handlers and the screens. The
app says who the people are, where things are kept, how a file is uploaded, what a finished day
becomes for the people told, how search hears about it, and how it looks.

## Install

```bash
npm install @supersuit/journey
```

Peers: `react` and `react-dom` 19, `next` 16, and `firebase-admin` 13 for the server entry. With
Tailwind 4, add to the stylesheet that imports Tailwind:

```css
@source "../node_modules/@supersuit/journey/dist";
```

## Three entry points

Each entry exports a fixed list of names, and nothing else.

**`@supersuit/journey`** is plain and loads anywhere (a server page, a script, a machine that
sends items):

- the refusal: `RuleError`, `isRuleError`;
- validators: `validateDay`, `validateAt`, `validateKey`, and `dayIn(at, timeZone)` for the day
  an instant falls on;
- formatters: `formatDay(day)`, `formatWhen(at, now?, timeZone?)`, `fromLine(by, names)`;
- the statuses: `CONTRIBUTE_STATUSES` and the `ContributeStatus` type;
- the caps: `KEY_MAX`, `TITLE_MAX`, `LINE_MAX`, `SUMMARY_MAX`, `WORDS_MAX`, `ACCOUNT_MAX`,
  `ITEMS_PER_CALL`, `DAY_MAX_ITEMS`, `DAY_MAX_BYTES`, `AKA_MAX`, `THUMBS_PER_DAY`,
  `VIDEO_MAX_DURATION_SEC`, `DAYS_PAGE_DEFAULT`, `DAYS_PAGE_MAX`, and `ITEM_KINDS`;
- every type a caller or an app reads: `NewItem`, `NewMedia`, `ContributeAnswer`,
  `ContributeResult`, `DayView`, `DayRow`, `DaysPage`, `AgentDay`, `SearchDay`, `RemovedRow`,
  `MemberNames` and the records they are built from.

**`@supersuit/journey/server`** is server only: `createJourneyStore(host)`,
`createJourneyHandlers(host, store?)`, `handle`, and the types `JourneyHost`, `Destination`,
`JourneyStore`, `JourneyHandlers`, `SearchDay`, `SearchItem`.

**`@supersuit/journey/client`** exports three components, `JourneyProvider`, `JourneyHome` and
`JourneyDay`, and two types, `JourneyClientConfig` and `ThemeTokens`. It exports no function that
is not a component and no constant.

## What a day holds

A day is one record, keyed by its date (`YYYY-MM-DD`) in the one time zone the app names. It holds
items and, once written, an account in plain prose.

An item has a `key`, a `kind`, a time `at` (an ISO instant with an offset that falls on the day in
the app's zone), and the members whose machines contributed it.

**The key** is the contributor's own stable identity for the item, unique on the day, usually
`<source>:<id>`. It is 1 to 300 characters. Spaces inside it and letters of any script are kept
as they come. It is refused when it holds a control character (U+0000 to U+001F, U+007F), starts
or ends with whitespace, holds half of a surrogate pair, or has the form `__name__`, which the
database keeps for itself. A call's `meetingKey` has its own, narrower rule: 1 to 200 printable
ASCII characters with no spaces.

| Kind | Must carry | May carry |
| --- | --- | --- |
| `call` | `title` | `summary`, `meetingKey`, `media` (a video) |
| `call` with `others: true` | `title` | `line`, `meetingKey`. Never a summary or media. |
| `photo` | `media` (a photo) | `title` |
| `video` | `media` (a video) | `title` |
| `text` | `words` | `title`, `from` |
| `shipped` | `title` | |

A text's `from` says who wrote it: `"me"` (the member whose machine sends it) or `"other"` (the
other member, which needs the host's `members`). It is stored as that member's key and shown as
the text's author; without it, a text is shown as from whose machine sent it, which is wrong for
the other person's half of a shared thread.

Lengths: `title` and `line` 200, `summary` 1,200, `words` 600, the account 6,000.

### Caps

| Cap | Value | What happens at it |
| --- | --- | --- |
| Items in one call | 60 | The 61st refuses the whole call with a 400. |
| Items on one day | 300 | Each item past it is answered `invalid` with `this day is full`. A removed item still takes its place. |
| Size of one day | 900,000 bytes of JSON | An item that would take the day past it is answered `invalid` with `this day is full`, and the day is written without it. Smaller items after it still land. A narrowing (see below) is never held back by size. |
| Other keys for one call | 8 | A ninth distinct key for the same call is answered `present` and is not written down. If it says `others: true`, the call is still narrowed. |
| Thumbnails on a day row | 4 | The rest are left off the row. |

## The host (server)

The `JourneyHost<M>` type, exported from `@supersuit/journey/server`, documents every member in
its JSDoc. `createJourneyStore` checks the host when the app starts and throws, naming the missing
part, rather than failing on a person's first tap. In short:

- `member(req)` says who is asking, or `null`. **The host enforces membership.**
- `members` (optional): every member's key, so a text sent with `from: "other"` is filed under
  the other member. Without it such a text is answered `invalid`.
- `db()`, `collection` (one record per day) and `mediaCollection` (one record per filed upload,
  under the upload's own id). Two lists, never the same one.
- `timeZone`: the one zone a day is counted in. **It must be the zone the contributing machines
  bucket their days in.** An item whose `at` does not fall on the day it was sent to, counted in
  this zone, is answered `invalid`, so a caller that buckets by another zone has every item near
  midnight refused. The agent day read hands the zone back as `timeZone`.
- `media.signedUrl`, and the app's own upload pipeline as `media.filePhoto` and `media.fileVideo`.
  The pipeline must check that the upload was issued to the member, claim it once, and refuse a
  record that already exists. It files into `into.ref`, which is always
  `<mediaCollection>/<uploadId>`.
- `agent.member(req)`, `agent.photoTicket`, `agent.videoTicket`: how a machine acts as exactly one
  member. Without the `agent` block every agent route answers 401.
- `isRefusal(err)` and `log(message, err)`, both optional. `isRefusal` says which of the app's own
  errors may be shown to a caller (the package's own refusals always are): pass your upload
  pipeline's refusal check, and a refused upload answers that one item `invalid` with the
  pipeline's words. Anything else the pipeline throws is logged and answers that item `invalid`
  with `that upload could not be read`. Either way the rest of the batch lands. `log` receives
  every failure a caller must not see.

Hooks tell the app that something happened. Some are waited for and some are left running:

| Hook | When | Waited for? | If it throws or rejects |
| --- | --- | --- | --- |
| `announce.dayWritten(day, by)` | The first time a day is ever written up. Rewrites are quiet. | Yes, before the write answers. | Logged. The write still succeeds, and the announcement is not retried. |
| `index.item(day, key)` | After an item is added, merged or restored. | No. | Logged, nothing else. Back it with a pass of your own. |
| `index.day(day)` | After an account is written. | No. | Logged, nothing else. |
| `forget.item(day, key)` | When an item is removed, and when a call is narrowed to one with other people present. | Yes, before the request answers. | Logged, and the forget stays owed: see below. |
| `forget.day(day)` | When either of those happens on a day that already had an account, since the account may tell of what was hidden or stripped. | Yes, before the request answers. | Logged, and the forget stays owed. |

### A forget that fails stays owed

The write that hides an item or strips a call also records what search owes: `owesForget` on the
item, and `accountOwesForget` on the day when it had an account. After that write is saved the
store awaits `forget.item` and `forget.day`, and strikes off what search confirmed in a second
write. If a forget throws, its mark stays.

Every later call that writes that day (`contribute`, `remove`, `restore`, `setAccount`) first
asks search again for everything the day still owes, once per call, and clears what search
confirms. This happens before the call's own write, so it happens even when that write is then
refused. So a search that was down is
caught up by the next thing that happens to the day. Make `forget.item` and `forget.day` safe to
call twice.

While an item owes a forget, `index.item` is never called for it. When the forget is confirmed
and the item is still on the day, `index.item` is called then. The same holds for the account and
`index.day`.

The caller is told as well. A removal answers 409 with `removed: true` (see Removal). A merge that
narrowed a call reports that row `failed`, and sending it again is what asks search again.

### What search may read

`journey.searchDay(day)` is the one read a search indexer should use, from `index.item`,
`index.day` or a pass of its own:

```ts
const found = await journey.searchDay('2031-04-05')
// null when nothing was ever contributed to the day, else:
// { day: '2031-04-05',
//   items: [ { key, kind, at, by, title?, line?, summaries?, words?, from?, thumbPath? } ],
//   account?: 'the account text' }
```

It holds visible items only. A removed item is absent. An item that still owes a forget is absent
entirely. `account` is present only when the account is shown to members and owes no forget.
`summaries` is keyed by member, and `thumbPath` is a stored path, never a signed URL. An index
built only from this read cannot hold what a removal or a narrowing took away.

```ts
import { createJourneyHandlers, createJourneyStore, type JourneyHost } from '@supersuit/journey/server'

export const host: JourneyHost<'ada' | 'bo'> = { /* see the type */ }
export const journey = createJourneyStore(host)
export const journeyHandlers = createJourneyHandlers(host, journey)
```

The store is also what server code reads from: `journey.listDays()`, `journey.getDay(day)` and
`journey.searchDay(day)`.

## Routes

Each route file is one line. `[day]` is the date.

| Route file | Export |
| --- | --- |
| `api/journey/days/route.ts` | `export const { GET } = journeyHandlers.days` |
| `api/journey/days/[day]/route.ts` | `export const { GET } = journeyHandlers.day` |
| `api/journey/days/[day]/item/route.ts` | `export const { DELETE, POST } = journeyHandlers.item` |
| `api/journey/days/[day]/removed/route.ts` | `export const { GET } = journeyHandlers.removed` |
| `api/journey/agent/ticket/route.ts` | `export const { POST } = journeyHandlers.agent.ticket` |
| `api/journey/agent/days/[day]/route.ts` | `export const { GET } = journeyHandlers.agent.day` |
| `api/journey/agent/days/[day]/items/route.ts` | `export const { POST } = journeyHandlers.agent.items` |
| `api/journey/agent/days/[day]/account/route.ts` | `export const { PUT } = journeyHandlers.agent.account` |

Every route file also declares `export const runtime = 'nodejs'`. The `items` route runs the
app's upload pipeline, so give it room: `export const maxDuration = 300`.

A member route asks the session and nothing else (`403 { "error": "private" }` without one). An
agent route asks the agent key and nothing else (`401 { "error": "agent key required" }` without
one). Neither opens for the other's credential.

Every refusal answers `{ "error": "<words a person can read>" }` with its own status. Two carry
one more field a machine acts on: a stale account carries `hash`, and a removal that search could
not follow carries `removed: true`. A body that is not JSON answers 400. Anything else answers an
opaque 500 and goes to the server's log.

### Member routes

- `GET days?before=<day>&limit=<n>`: `{ days: [{ day, firstLine, thumbs, count }], next }`, newest
  first. `next` is the cursor to pass as `before`, or `null`. A day with nothing left on it is not
  a row.
- `GET days/<day>`: the day as the page draws it (`day`, `account`, `accountPending`, `groups`,
  `removedCount`), or `404 { "error": "not found" }` when nothing was ever contributed to it.
- `DELETE days/<day>/item?key=<item key>`: removes (hides) the item. `POST` to the same address
  restores it. Both answer `{ day, key, removedCount }`. The key rides in the query string,
  URL-encoded, because it may hold colons, slashes and spaces. A removal that search could not
  follow answers `409 { "removed": true, "error": "Removed. Search will
  catch up shortly." }`: the item is hidden all the same.
- `GET days/<day>/removed`: `{ removed: [{ key, kind, title?, by, at }] }`, most recent first.
  Titles and kinds only, never media.

## What a machine sends

The agent routes are written for a caller that posts what is new for a day, again and again,
keeps an item it could not land and sends it again, and forgets a key for good when it is told to
(an outlet of `@supersuit/context-river` works this way).

**A ticket**, for each photo or video, then the bytes to the URL it gives:

```
POST api/journey/agent/ticket   { "kind": "photo" }
  200 { "uploadId": "…", "url": "…", "headers": { "Content-Type": "image/jpeg" } }

POST api/journey/agent/ticket   { "kind": "video", "contentType": "video/mp4", "size": 1048576 }
  200 { "uploadId": "…", "videoUrl": "…", "posterUrl": "…", "requiredHeaders": { "video": { … }, "poster": { … } } }
```

**Take a fresh ticket for each attempt.** Tickets expire, and an upload is claimed once. A caller
that sends an item again after a failure should upload again on a new ticket. A resend whose
first answer was lost is recognised either way: the key is already on the day, so the row is
`present` and nothing is filed, and an `uploadId` that was already filed for that same day, key
and member is used as it stands.

**Its items for one day.** Send only what is new; sending something again is harmless.

```
POST api/journey/agent/days/2031-04-05/items
{ "items": [
  { "key": "conversations:abc", "kind": "call", "at": "2031-04-05T15:00:00Z", "title": "Weekly sync",
    "summary": "They planned the week.", "meetingKey": "mk-1" },
  { "key": "camera-roll:p1", "kind": "photo", "at": "2031-04-05T15:20:00Z", "media": { "uploadId": "…", "kind": "photo" } },
  { "key": "camera-roll:v1", "kind": "video", "at": "2031-04-05T15:40:00Z",
    "media": { "uploadId": "…", "kind": "video", "durationSec": 62.5, "width": 1920, "height": 1080 } },
  { "key": "messages:t1", "kind": "text", "at": "2031-04-05T16:30:00Z", "words": "Shipping it today.", "from": "other" },
  { "key": "shipped:repo/v1.2.0", "kind": "shipped", "at": "2031-04-05T21:00:00Z", "title": "Released 1.2.0" },
  { "key": " padded", "kind": "shipped", "at": "2031-04-05T21:05:00Z", "title": "A key with a space at its start" }
] }

200 { "day": "2031-04-05", "hash": "9f2c41d07a6be835",
      "results": [
        { "index": 0, "key": "conversations:abc", "status": "added" },
        { "index": 1, "key": "camera-roll:p1", "status": "added" },
        { "index": 2, "key": "camera-roll:v1", "status": "added" },
        { "index": 3, "key": "messages:t1", "status": "present" },
        { "index": 4, "key": "shipped:repo/v1.2.0", "status": "refused", "reason": "removed by a member" },
        { "index": 5, "key": " padded", "status": "invalid", "reason": "key must be 1 to 300 characters, …" }
      ],
      "refused": [ "shipped:repo/v1.2.0" ] }
```

There is one row in `results` for every item sent, in the order sent. `index` is the item's
place in the request. `key` is the key as it was given when it was text, and an empty string
otherwise. `reason` is present on `refused`, `invalid` and `failed` rows. `refused` lists the keys
of the `refused` rows.

**One item never refuses the rest.** A key that breaks the rule, a key that is not text, an item
that is not an object, a rule the item breaks, an upload that is missing or cannot be read: each
fails its own row. The whole call is refused with a 400 only for a body that is not JSON, a day
that is missing or not a date, a body whose `items` is not a list, or more than 60 items. An
empty list answers 200 with no rows.

Each row's `status` is one of six, and each tells the caller exactly one thing to do:

| Status | Meaning | What the caller does |
| --- | --- | --- |
| `added` | The item is on the day. | Keeps the receipt. Never sends it again. |
| `merged` | The other machine already sent this call; this one joined it. | Keeps the receipt. Never sends it again. |
| `present` | The day already had this key, or the call it names. | Keeps the receipt. Never sends it again. |
| `refused` | A member removed this item. Permanent. | Forgets the key for good (a tombstone). Never sends it again. |
| `invalid` | It cannot be kept as it is: a rule it broke, a full day, an upload that is missing or cannot be read. | Reports it. Does not send it again as it is. |
| `failed` | Something passing got in the way. Today that is one case: a merge that narrowed a call while search could not forget. | Keeps it and sends it again. |

When two machines send the same call (the same `meetingKey`, on the same day), the day holds one
item with both contributors and both summaries. If either says `others: true`, the item is
**narrowed** to a call with other people present: its recording and every summary are dropped, a
title and one line stay, `forget.item` runs for it, and on a day that was already written up the
account is withheld and `forget.day` runs too. The recording's files stay in the bucket; the
module never deletes a file.

The same holds for a removed call. Its second recording is answered `refused` like any key that
names a removed item, but if it says `others: true` the removed call is narrowed where it lies,
so restoring it later brings back a title and one line and nothing more.

**The account.** Read the day, write from it, send the hash back:

```
GET api/journey/agent/days/2031-04-05
  200 { "day": "2031-04-05", "timeZone": "America/Chicago", "hash": "9f2c41d07a6be835",
        "account": null, "accountStale": false,
        "items": [ { "key": "…", "aka": ["…"], "kind": "call", "at": "…", "by": ["ada", "bo"], "title": "…",
                     "summaries": { "ada": "…", "bo": "…" }, "hasMedia": false }, … ] }

PUT api/journey/agent/days/2031-04-05/account   { "text": "Plain prose.", "basedOn": "9f2c41d07a6be835" }
  200 { "day": "2031-04-05", "hash": "9f2c41d07a6be835", "first": true }
  409 { "error": "the day changed since it was read", "hash": "<the hash to read again from>" }
  409 { "error": "nothing is left on this day to write about", "hash": "…" }
  404 { "error": "no such day" }
```

A day nothing was contributed to reads as an empty one, with no items. `timeZone` is the host's.
The hash changes when an item arrives, when a second machine joins a call, when a call is
narrowed, and when an item is removed or restored. It stays the same when nothing did, so a
machine rewrites a day only when there is something new to say. It never covers the words.

Write the day again when `account` is `null` or `accountStale` is `true`. The account is plain
prose in paragraphs: markdown is refused, since the page prints it as it is. A withheld account
(see Removal) reads as `null`.

## Removal

Either person can remove any item, their own or the other's. Removing **hides**. Nothing is ever
deleted: the item stays in the record with who removed it and when, and its files stay in the
bucket. From that moment it is in no list, no day page, no account read and no search read, and
its key is refused whenever a machine sends it again (under any key that names the same call). A
day that already had an account marks it stale and withholds it until it is written again: the
page, the agent read and the search read show none.

**A removal can answer an error while the item is already hidden.** The removal is saved first,
with the forget it owes. Then search is told to forget the item (and the day's account, when
there was one), and the request waits for that. If search cannot, the route answers

```
409 { "removed": true, "error": "Removed. Search will catch up shortly." }
```

`removed: true` is how a client tells this from a removal that did not happen. The item is hidden
all the same, and the forget stays owed on the day (see "A forget that fails stays owed"). Sending
the same removal again changes nothing more and asks search again; so does any later write to
that day.

Restoring puts the item back as it was, marks the account stale, and lets `index.item` follow
without waiting, unless the item still owes a forget.

The day page keeps a line saying how many items were removed. It opens a list with each item's
title or kind, who removed it and when (never its media), and a Restore control.

## The screens (client)

```tsx
import { JourneyProvider, JourneyHome, JourneyDay } from '@supersuit/journey/client'

<JourneyProvider config={{ apiBase: '/api/journey', pageBase: '/journey' }} theme={{ ink: '#222222' }}>
  <JourneyHome days={page.days} next={page.next} newDays={newDays} />
</JourneyProvider>

<JourneyProvider config={{ apiBase: '/api/journey', pageBase: '/journey' }}>
  <JourneyDay view={view} names={{ ada: 'Ada', bo: 'Bo' }} />
</JourneyProvider>
```

- `JourneyProvider` takes `config` (`apiBase`, where the member handlers are mounted, and
  `pageBase`, where the pages live) and an optional `theme`. Both are plain values, so a server
  component can render it. **The provider is the only way a look reaches the screens.** `theme`
  takes any of `serif`, `bg`, `ink`, `muted`, `hairline`, `onInk`, `accent`, `danger`; whatever is
  left out is drawn in the default. Nothing is kept outside the React tree, so two providers on
  one page each keep their own look and addresses, and a provider never inherits from another
  one. A screen rendered outside a provider throws, naming what is missing.
- `JourneyHome` takes the first page the app read on the server (`days` and `next` from
  `journey.listDays()`), and fetches earlier pages itself. Each row shows the date, the first
  line of the account, the item count (on every row, written up or not), and up to four
  thumbnails. Which days are new to this person is the app's to know: pass their dates as
  `newDays`. `empty` replaces the line shown when there are no days.
- `JourneyDay` takes one day as `view` (`journey.getDay(day)`) and the people's `names`, a map
  from member key to the name to show. A member with no name is shown by key.

**Remove asks one confirmation.** Tapping Remove replaces it with "Remove for everyone?" and two
buttons, "Yes, remove" and "Keep". Focus moves to Keep; choosing Keep returns it to Remove.
Nothing is sent until "Yes, remove", and a second tap while the request is on its way sends
nothing more. What the page then says is what happened:

| What happened | What the page shows |
| --- | --- |
| Removed | The day is read again and drawn as the server has it. |
| Removed, though search could not follow (409 with `removed: true`) | The day is read again, the item is gone, and a quiet note carries the server's words. |
| Removed or restored, and the day could not be read again | The item is taken off the page (or the list closes and the count is corrected), and a note says the page could not refresh. It never says "Not removed". |
| 401 or 403 | "You are signed out. Reload to sign in again." on the row, or the server's own words when it gave some beyond the bare `private`. It does not say to try again. |
| Any other failure | The server's `error` words on the row that failed, else "Not removed. Try again." (for a restore, "Not restored. Try again."). |

`formatDay`, `formatWhen` and `fromLine` are in the root entry, for an app that prints a day, a
moment or a contributor somewhere of its own.

The package holds no person's name and no app's name. Names arrive as props.

## What is deliberately left uncovered

- **The same photo under a different key after a removal.** A removal refuses the item's key. The
  same picture sent again under a new key is a new item.
- **A call sent with no `meetingKey`.** Two recordings of it never merge, and after it is removed
  a re-send under a new key is a new item. Calls that two machines both record need a
  `meetingKey`.
- **Two recordings of one call that straddle midnight.** Each lands on its own day, and a merge
  happens only inside one day.
- **Two overlapping account writes.** Each is checked against `basedOn`. Two written from the
  same reading of an unchanged day both succeed, the later one stands, and exactly one is
  `first`. One written from an older reading is refused with the hash to read again from.
- **Files.** Nothing in the bucket is ever deleted: a removed item's files and a narrowed call's
  recording stay where they were filed, and no read hands out a path or a URL to them.

## Development

```bash
npm install
npm run check
```

`check` runs the typecheck, the tests, the build and its dist check, the private-words check, the
comment-dates check, the mutation check and the consumer build.

The private-words check reads its list from outside the repository: `PRIVATE_WORDS_FILE` (a path)
or `PRIVATE_WORDS` (the words, one per line or separated by commas). It scans the sources, the
tests with the consumer app's own sources, the scripts and workflows, this file, the changelog,
the licence, `package.json` and the configuration at the root. With no list it is skipped and
says so; the publish workflow passes `--require`, so a release cannot ship unscanned.

## Releasing

A release is a tag push. Bump `version` in `package.json`, add the CHANGELOG entry, stage
`package-lock.json` with `package.json`, commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
Below 1.0, an addition is a patch and a breaking change is a minor. Only a pushed `v*` tag
publishes: running the publish workflow by hand is always a dry run.

## License

MIT
