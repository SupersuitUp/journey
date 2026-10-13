'use client'

import { JourneyDay, JourneyHome, JourneyProvider } from '@supersuit/journey/client'

const NAMES = { a: 'A', b: 'B' }

export function Screens() {
  return (
    <JourneyProvider config={{ apiBase: '/api/journey', pageBase: '/days' }} theme={{ ink: '#222222' }}>
      <JourneyHome days={[{ day: '2031-04-05', firstLine: 'A day.', thumbs: [], count: 1 }]} next={null} newDays={['2031-04-05']} />
      <JourneyDay
        names={NAMES}
        view={{
          day: '2031-04-05', account: { text: 'A day.', by: 'a', at: '2031-04-06T09:00:00.000Z' }, accountPending: false, removedCount: 1,
          groups: [
            { name: 'calls', items: [] }, { name: 'media', items: [] }, { name: 'texts', items: [] },
            { name: 'shipped', items: [{ key: 'shipped:one', kind: 'shipped', at: '2031-04-05T18:00:00.000Z', by: ['a'], title: 'Shipped one', summaries: [] }] },
          ],
        }}
      />
    </JourneyProvider>
  )
}
