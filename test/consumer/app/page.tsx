import { DAY_MAX_ITEMS, formatDay, validateDay } from '@supersuit/journey'
import { Screens } from './screens'

export const dynamic = 'force-dynamic'

// A server component using the plain entry, rendering the client screens beneath it.
export default function Page() {
  return <main><p>{formatDay(validateDay('2031-04-05'))}: a day holds up to {DAY_MAX_ITEMS} items</p><Screens /></main>
}
