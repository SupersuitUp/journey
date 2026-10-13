import { GROUP_ORDER, dayHash } from '@supersuit/journey'
import { Screens } from './screens'

export const dynamic = 'force-dynamic'

// A server component using the plain entry, rendering the client screens beneath it.
export default function Page() {
  return <main><p>{GROUP_ORDER.length} groups, an empty day hashes to {dayHash({})}</p><Screens /></main>
}
