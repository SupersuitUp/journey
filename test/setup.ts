import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'
import { configure } from '../src/client/config.js'

// Calls are forgotten between tests; what a stand-in does when called is kept.
beforeEach(() => {
  vi.clearAllMocks()
})

// Every screen test runs configured, as an app configures the screens. These values live here and
// in tests only, never as defaults in src/.
configure({ apiBase: '/api/journey', pageBase: '/journey' })
