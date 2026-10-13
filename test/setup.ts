import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// Calls are forgotten between tests; what a stand-in does when called is kept.
beforeEach(() => {
  vi.clearAllMocks()
})
