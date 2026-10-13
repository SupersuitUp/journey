'use client'

import { createContext, useContext } from 'react'
import type { JourneyClientConfig } from './config.js'
import type { ThemeTokens } from './theme.js'

export interface JourneyContextValue { config: JourneyClientConfig; theme: ThemeTokens }

// Where things are and how they look travel down the tree from the provider. Nothing is kept in a
// module, so two providers on one page, or two requests rendered on one server, share nothing.
export const JourneyContext = createContext<JourneyContextValue | null>(null)

export function useJourney(): JourneyContextValue {
  const value = useContext(JourneyContext)
  if (!value) throw new Error('Journey is not configured: render its screens inside <JourneyProvider>')
  return value
}
