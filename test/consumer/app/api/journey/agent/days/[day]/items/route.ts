import { handlers } from '../../../../../../../lib/host'

export const runtime = 'nodejs'
// Filing a batch runs the app's upload pipeline for each photo and video in it.
export const maxDuration = 300
export const { POST } = handlers.agent.items
