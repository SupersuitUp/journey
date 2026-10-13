# Changelog

Version convention: below 1.0, an addition is a patch and a breaking change is a minor (npm reads `^0.1.2` as 0.1.x only, so an app takes a patch on its own and holds a minor for a person).

## 0.1.0

First release.

- **Days.** One record per calendar date in the zone the app names. Each person's machine contributes calls, photos, video, texts and shipped work; the same key again changes nothing; the same call from two machines becomes one item with both contributors and both summaries. If either machine says other people were present, the call is narrowed to a title and one line, and search forgets the item and the day's account.
- **Keys.** 1 to 300 characters, spaces and any script allowed, with no control character, no whitespace at either end and never the form `__name__`.
- **Contributing.** One row comes back for every item sent, in order, carrying its `index`, its `key` and one of six statuses: `added`, `merged`, `present`, `refused`, `invalid`, `failed`. One item that cannot be kept never refuses the rest of the call.
- **Caps.** 60 items in a call, 300 on a day, 900,000 bytes for a day's record, 8 other keys for one call.
- **Removal hides, it never deletes.** Either person can remove any item. It leaves every read and the day's hash, its key is refused from then on, and it can be seen and restored from the day page. The second recording of a removed call is refused too, and still narrows it when it says others were present.
- **A forget that fails stays owed.** The write that hides or narrows an item records what search owes. Search is asked before the request answers, and again by every later write to that day until it confirms. A removal that search could not follow answers 409 with `removed: true`, with the item hidden all the same. Nothing that owes a forget is indexed.
- **`searchDay(day)`.** The one read a search indexer should use: visible items and the account, with nothing removed, withheld or still owing a forget.
- **The account.** Written by an agent route against the hash of the day it was read from; refused with a 409 and the current hash when the day has moved. The first time a day is written up is the one moment anyone is told, and that announcement is waited for before the write answers. The agent day read carries the host's time zone.
- **Media through the app's own upload pipeline**, by the app's own tickets. An upload the pipeline refuses or cannot read fails its own item.
- **Route handlers** for members and for each member's agent key, which never open for each other's credential.
- **Screens:** `JourneyProvider`, `JourneyHome`, `JourneyDay`. The look and the addresses reach the screens through the provider alone. Remove asks one confirmation, and the page says what happened on the row it happened to.
- **Three entry points**, each a fixed list of names: the root (types, validators, formatters, statuses, caps), `/server`, and `/client` (components and types only).
