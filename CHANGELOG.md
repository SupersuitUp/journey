# Changelog

Version convention: below 1.0, an addition is a patch and a breaking change is a minor (npm reads `^0.1.2` as 0.1.x only, so an app takes a patch on its own and holds a minor for a person).

## 0.1.0

First release.

- **Days.** One record per calendar date in the zone the app names. Each person's machine contributes calls, photos, video, texts and shipped work; the same key again changes nothing; the same call from two machines becomes one item with both contributors and both summaries.
- **Removal hides, it never deletes.** Either person can remove any item. It leaves every read and the day's hash, search forgets it before the request answers, its key is refused from then on, and it can be seen and restored from the day page. If search cannot forget, the removal answers an error while the item stays hidden, and sending it again runs the forget again.
- **The account.** Written by an agent route against the hash of the day it was read from; refused with a 409 and the current hash when the day has moved. The first time a day is written up is the one moment anyone is told, and that announcement is waited for before the write answers.
- **Media through the app's own upload pipeline**, by the app's own tickets.
- **Route handlers** for members and for each member's agent key, which never open for each other's credential.
- **Screens:** `JourneyProvider`, `JourneyHome`, `JourneyDay`. Remove asks one confirmation.
