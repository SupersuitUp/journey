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

- `@supersuit/journey`: the types and every rule, pure. Safe to import anywhere.
- `@supersuit/journey/server`: `createJourneyStore(host)`, `createJourneyHandlers(host, store?)` and `assertHostFits(host)`. Server only.
- `@supersuit/journey/client`: `JourneyProvider`, `JourneyHome`, `JourneyDay`, `setTheme`.

## What a day holds

A day is one record, keyed by its date (`YYYY-MM-DD`) in the one time zone the app names. It holds
items and, once written, an account in plain prose.

An item has a `key` (the contributor's own stable identity for it, unique on the day, usually
`<source>:<id>`), a `kind`, a time `at` (an ISO instant with an offset that falls on the day in the
app's zone), and the members whose machines contributed it.

| Kind | Must carry | May carry |
| --- | --- | --- |
| `call` | `title` | `summary`, `meetingKey`, `media` (a video) |
| `call` with `others: true` | `title` | `line`, `meetingKey`. Never a summary or media. |
| `photo` | `media` (a photo) | `title` |
| `video` | `media` (a video) | `title` |
| `text` | `words` | `title` |
| `shipped` | `title` | |

Lengths: `title` and `line` 200, `summary` 1,200, `words` 600, the account 6,000. At most 60
items in one call, and 300 on one day.

## The host (server)

The `JourneyHost<M>` type, exported from `@supersuit/journey/server`, documents every member in
its JSDoc. `createJourneyStore` checks the host when the app starts and throws, naming the missing
part, rather than failing on a person's first tap. In short:

- `member(req)` says who is asking, or `null`. **The host enforces membership.**
- `db()`, `collection` (one record per day) and `mediaCollection` (one record per filed upload,
  under the upload's own id). Two lists, never the same one.
- `timeZone`: the one zone a day is counted in.
- `media.signedUrl`, and the app's own upload pipeline as `media.filePhoto` and `media.fileVideo`.
  The pipeline must check that the upload was issued to the member, claim it once, and refuse a
  record that already exists. It files into `into.ref`, which is always
  `<mediaCollection>/<uploadId>`.
- `agent.member(req)`, `agent.photoTicket`, `agent.videoTicket`: how a machine acts as exactly one
  member. Without the `agent` block every agent route answers 401.
- `isRefusal(err)` and `log(message, err)`, both optional. `isRefusal` says which of the app's own
  errors may be shown to a caller (the package's own refusals always are): pass your upload
  pipeline's refusal check, and a refused upload fails that one item with the pipeline's words
  while the rest of the batch lands. Without it a refused upload fails the whole call as a 500.
  `log` receives every failure a caller must not see.

Four hooks tell the app that something happened. Two are waited for and two are not:

| Hook | When | Waited for? | If it throws |
| --- | --- | --- | --- |
| `announce.dayWritten(day, by)` | The first time a day is ever written up. Rewrites are quiet. | Yes, before the write answers. | Logged. The write still succeeds, and the announcement is not retried. |
| `index.item(day, key)` | After an item is added, merged or restored. | No. | Logged, nothing else. Back it with a pass of your own. |
| `index.day(day)` | After an account is written. | No. | Logged, nothing else. |
| `forget.item(day, key)` and `forget.day(day)` | When an item is removed (`forget.day` too when the day already had an account), and when a merge turns a call into one with other people present. | Yes, before the request answers. | Logged, and the caller is told: see Removal. |

```ts
import { createJourneyHandlers, createJourneyStore, type JourneyHost } from '@supersuit/journey/server'

export const host: JourneyHost<'ada' | 'bo'> = { /* see the type */ }
export const journey = createJourneyStore(host)
export const journeyHandlers = createJourneyHandlers(host, journey)
```

The store is also what server components read from: `journey.listDays()` and
`journey.getDay(day)`.

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

Every refusal answers `{ "error": "<words a person can read>" }` with its own status. A body that
is not JSON answers 400. Anything else answers an opaque 500 and goes to the server's log.

### Member routes

- `GET days?before=<day>&limit=<n>`: `{ days: [{ day, firstLine, thumbs, count }], next }`, newest
  first. `next` is the cursor to pass as `before`, or `null`. A day with nothing left on it is not
  a row.
- `GET days/<day>`: the day as the page draws it (`day`, `account`, `accountPending`, `groups`,
  `removedCount`), or `404 { "error": "not found" }` when nothing was ever contributed to it.
- `DELETE days/<day>/item?key=<item key>`: removes (hides) the item. `POST` to the same address
  restores it. Both answer `{ day, key, removedCount }`. The key rides in the query string because
  it holds colons and slashes.
- `GET days/<day>/removed`: `{ removed: [{ key, kind, title?, by, at }] }`, most recent first.
  Titles and kinds only, never media.

## What a machine sends

**A ticket**, for each photo or video, then the bytes to the URL it gives:

```
POST api/journey/agent/ticket   { "kind": "photo" }
  200 { "uploadId": "…", "url": "…", "headers": { "Content-Type": "image/jpeg" } }

POST api/journey/agent/ticket   { "kind": "video", "contentType": "video/mp4", "size": 1048576 }
  200 { "uploadId": "…", "videoUrl": "…", "posterUrl": "…", "requiredHeaders": { "video": { … }, "poster": { … } } }
```

**Its items for one day.** Send only what is new; sending something again is harmless.

```
POST api/journey/agent/days/2031-04-05/items
{ "items": [
  { "key": "conversations:abc", "kind": "call", "at": "2031-04-05T15:00:00Z", "title": "Weekly sync",
    "summary": "They planned the week.", "meetingKey": "mk-1" },
  { "key": "camera-roll:p1", "kind": "photo", "at": "2031-04-05T15:20:00Z", "media": { "uploadId": "…", "kind": "photo" } },
  { "key": "camera-roll:v1", "kind": "video", "at": "2031-04-05T15:40:00Z",
    "media": { "uploadId": "…", "kind": "video", "durationSec": 62.5, "width": 1920, "height": 1080 } },
  { "key": "messages:t1", "kind": "text", "at": "2031-04-05T16:30:00Z", "words": "Shipping it today." },
  { "key": "shipped:repo/v1.2.0", "kind": "shipped", "at": "2031-04-05T21:00:00Z", "title": "Released 1.2.0" }
] }

200 { "day": "2031-04-05", "hash": "9f2c41d07a6be835",
      "results": [ { "key": "conversations:abc", "status": "added" }, … ],
      "refused": [ ] }
```

One item that cannot be kept is reported by its key and the rest still land. An item with no usable
`key` cannot be reported, so it refuses the whole call with a 400, as does an empty list, more than
60 items, or a bad day. Each result's `status` is one of:

| Status | Meaning | Send again? |
| --- | --- | --- |
| `added` | The item is on the day. | No |
| `present` | The day already had this key. | No |
| `merged` | The other machine already sent this call; yours joined it. | No |
| `refused` | A member removed this item. Its key is also listed in `refused`. | Never |
| `failed` | It could not be kept this time. `reason` says why: a rule it broke, a full day, a refused upload, or `merged, but search could not be updated`. | Yes, once fixed |

When two machines send the same call (the same `meetingKey`), the day holds one item with both
contributors and both summaries. If either says `others: true`, the item is treated as a call with
other people present: its recording and summaries are dropped, and `forget.item` runs for it.

**The account.** Read the day, write from it, send the hash back:

```
GET api/journey/agent/days/2031-04-05
  200 { "day": "…", "hash": "9f2c41d07a6be835", "account": null, "accountStale": false,
        "items": [ { "key": "…", "aka": ["…"], "kind": "call", "at": "…", "by": ["ada", "bo"], "title": "…",
                     "summaries": { "ada": "…", "bo": "…" }, "hasMedia": false }, … ] }

PUT api/journey/agent/days/2031-04-05/account   { "text": "Plain prose.", "basedOn": "9f2c41d07a6be835" }
  200 { "day": "2031-04-05", "hash": "9f2c41d07a6be835", "first": true }
  409 { "error": "the day changed since it was read", "hash": "<the hash to read again from>" }
  409 { "error": "nothing is left on this day to write about", "hash": "…" }
  404 { "error": "no such day" }
```

A day nothing was contributed to reads as an empty one, with no items. The hash changes when an
item arrives, when a second machine joins a call, and when an item is removed or restored. It does
not change when nothing did, so a machine rewrites a day only when there is something new to say.
It never covers the words.

Write the day again when `account` is `null` or `accountStale` is `true`. The account is plain
prose in paragraphs: markdown is refused, since the page prints it as it is. A withheld account
(see Removal) reads as `null`.

## Removal

Either person can remove any item, their own or the other's. Removing **hides**. Nothing is ever
deleted: the item stays in the record with who removed it and when. From that moment it is in no
list, no day page and no account read, and its key is refused whenever a machine sends it again
(under any key that names the same call). A day that already had an account marks it stale, and
withholds it until it is written again: the page and the agent read show none, and search
forgets it.

**A removal can answer an error while the item is already hidden.** The removal is saved first,
then search is told to forget the item (and the day's account, when there was one), and the request
waits for that. If search cannot, the route answers `409 { "error": "Removed, but search could not
be updated. Try again." }`. The item is hidden all the same. Sending the same removal again
changes nothing more and runs the forgets again, so a repeat is how a failed forget gets its
second try. Restoring has no such step: it marks the account stale and lets `index.item` follow
without waiting.

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

- `JourneyProvider` takes plain values, so a server component can render it.
- `JourneyHome` takes the first page the app read on the server (`journey.listDays()`), and fetches
  earlier pages itself. Which days are new to this person is the app's to know: pass `newDays`.
  `empty` replaces the line shown when there are no days.
- `JourneyDay` takes one day (`journey.getDay(day)`) and the people's names. Every item has a
  Remove control. It asks **one confirmation** (Remove, then Confirm remove or Keep) and sends
  nothing until Confirm. If the request fails it says "Not removed. Try again." and the item stays
  where it was; because a removal can answer an error while the item is already hidden, trying
  again is safe and is what finishes the forget.
- `theme` takes `serif`, `bg`, `ink`, `muted`, `hairline`, `onInk`, `accent`, `danger`.

The package holds no person's name and no app's name. Names arrive as props.

## Development

```bash
npm install
npm run check
```

`check` runs the typecheck, the tests, the build and its dist check, the private-words check, the
comment-dates check, the mutation check and the consumer build.

The private-words check reads its list from outside the repository: `PRIVATE_WORDS_FILE` (a path)
or `PRIVATE_WORDS` (the words, one per line or separated by commas). With no list it is skipped
and says so; the publish workflow passes `--require`, so a release cannot ship unscanned.

## Releasing

A release is a tag push. Bump `version` in `package.json`, add the CHANGELOG entry, stage
`package-lock.json` with `package.json`, commit, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
Below 1.0, an addition is a patch and a breaking change is a minor.

## License

MIT
