'use client'

import { useMemo, type ReactNode } from 'react'
import type { JourneyClientConfig } from './config.js'
import { JourneyContext } from './context.js'
import { themeWith, type ThemeTokens } from './theme.js'

// Tells every Journey screen under it where its handlers and pages are and how the app looks.
// Both are plain values, so an app may render this straight from a server component. With no
// `theme` the screens draw in the default look; a provider never inherits from another one.
export function JourneyProvider({ config, theme, children }: { config: JourneyClientConfig; theme?: Partial<ThemeTokens>; children: ReactNode }) {
  const { apiBase, pageBase } = config
  const look = JSON.stringify(themeWith(theme))
  const value = useMemo(() => ({ config: { apiBase, pageBase }, theme: JSON.parse(look) as ThemeTokens }), [apiBase, pageBase, look])
  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>
}
