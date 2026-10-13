'use client'

import type { ReactNode } from 'react'
import { configure, type JourneyClientConfig } from './config.js'
import { setTheme, type ThemeTokens } from './theme.js'

// Configures Journey before anything under it draws: where its handlers and pages are, and the
// app's look. Both are plain values, so an app may render this straight from a server component.
export function JourneyProvider({ config, theme, children }: { config: JourneyClientConfig; theme?: Partial<ThemeTokens>; children: ReactNode }) {
  configure(config)
  if (theme) setTheme(theme)
  return <>{children}</>
}
