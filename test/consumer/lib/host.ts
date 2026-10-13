import { getFirestore } from 'firebase-admin/firestore'
import { createJourneyHandlers, type JourneyHost } from '@supersuit/journey/server'

// Nothing here reaches a database or a bucket at import time: the build needs no credentials,
// only the types to line up and the host to pass the package's start-up check.
const refuse = async (): Promise<never> => { throw new Error('the consumer app files nothing') }
export const host: JourneyHost<'a' | 'b'> = {
  member: async () => null,
  db: () => getFirestore(),
  collection: 'days',
  mediaCollection: 'day_media',
  timeZone: 'America/Los_Angeles',
  media: { signedUrl: refuse, filePhoto: refuse, fileVideo: refuse },
  agent: { member: async () => null, photoTicket: refuse, videoTicket: refuse },
  announce: { dayWritten: () => {} },
  index: { item: () => {}, day: () => {} },
  forget: { item: async () => {}, day: async () => {} },
}
export const handlers = createJourneyHandlers(host)
