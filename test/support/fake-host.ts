import { vi } from 'vitest'
import { fakeFirestore } from './fake-firestore.js'
import type { JourneyHost } from '../../src/server/host.js'
import type { FiledMedia } from '../../src/types.js'

export type M = 'ada' | 'bo'
export const PHOTO: FiledMedia = {
  kind: 'photo', takenAt: '2026-10-12T10:20:00', width: 3024, height: 4032,
  paths: { original: 'p/original/x.jpg', display: 'p/display/x.jpg', thumb: 'p/thumb/x.jpg' },
}

// A whole host, every part a stand-in. The app's pipeline is played by two functions that build
// the record the store asked for and create it at the place the store named, exactly once, as the
// real one does. Signing is visible in the URL. Every hook writes a line to `calls`, in order.
export function fakeHost(opts: { timeZone?: string; isRefusal?: JourneyHost<M>['isRefusal'] } = {}) {
  const f = fakeFirestore()
  const calls: string[] = []
  const host: JourneyHost<M> = {
    member: vi.fn(async () => 'ada' as M),
    db: () => f.db,
    collection: 'journey',
    mediaCollection: 'journey_media',
    timeZone: opts.timeZone ?? 'America/Chicago',
    ...(opts.isRefusal ? { isRefusal: opts.isRefusal } : {}),
    log: vi.fn(),
    media: {
      signedUrl: vi.fn(async (path: string) => `signed:${path}`),
      filePhoto: vi.fn(async (_m, photoId, clientTakenAt, into) => {
        const data = into.record({
          ...PHOTO, takenAt: clientTakenAt ?? PHOTO.takenAt,
          paths: { original: `p/original/${photoId}.jpg`, display: `p/display/${photoId}.jpg`, thumb: `p/thumb/${photoId}.jpg` },
        })
        await into.ref.create(data)
        return data
      }),
      fileVideo: vi.fn(async (_m, photoId, meta, into) => {
        const data = into.record({
          kind: 'video', takenAt: meta.takenAt ?? PHOTO.takenAt, width: meta.width, height: meta.height,
          paths: { original: `p/video/${photoId}.mp4`, display: `p/poster/${photoId}.jpg`, thumb: `p/poster/${photoId}.jpg` },
          video: { path: `p/video/${photoId}.mp4`, posterPath: `p/poster/${photoId}.jpg`, durationSec: meta.durationSec, contentType: 'video/mp4' },
        })
        await into.ref.create(data)
        return data
      }),
    },
    agent: {
      member: vi.fn(async () => 'ada' as M),
      photoTicket: vi.fn(async () => ({ photoId: 'upload-photo-1', url: 'https://put.example/photo', headers: { 'Content-Type': 'image/jpeg' } })),
      videoTicket: vi.fn(async () => ({
        photoId: 'upload-video-1', videoUrl: 'https://put.example/video', posterUrl: 'https://put.example/poster',
        requiredHeaders: { video: { 'Content-Type': 'video/mp4' }, poster: { 'Content-Type': 'image/jpeg' } },
      })),
    },
    announce: { dayWritten: vi.fn((day: string, by: M) => { calls.push(`announce.dayWritten:${day}:${by}`) }) },
    index: {
      item: vi.fn((day: string, key: string) => { calls.push(`index.item:${day}:${key}`) }),
      day: vi.fn((day: string) => { calls.push(`index.day:${day}`) }),
    },
    forget: {
      item: vi.fn(async (day: string, key: string) => { calls.push(`forget.item:${day}:${key}`) }),
      day: vi.fn(async (day: string) => { calls.push(`forget.day:${day}`) }),
    },
  }
  return { host, f, calls }
}
