// The look Journey draws with. An app hands its own to <JourneyProvider theme>; whatever it leaves
// out is drawn in the default below. Nothing here can be changed after it is loaded: the look a
// screen draws with reaches it through its provider and nowhere else.
export interface ThemeTokens {
  serif: string; bg: string; ink: string; muted: string; hairline: string; onInk: string
  accent: string; danger: string
}

export const DEFAULT_THEME: Readonly<ThemeTokens> = Object.freeze({
  serif: 'Georgia, serif', bg: '#ffffff', ink: '#1a1a1a', muted: '#767676', hairline: '#ececec', onInk: '#ffffff',
  accent: '#d94c63', danger: '#a33a3a',
})

/** The default look with the app's own values laid over it. A value left undefined keeps the default. */
export function themeWith(over: Partial<ThemeTokens> | undefined): ThemeTokens {
  const out: ThemeTokens = { ...DEFAULT_THEME }
  for (const [name, value] of Object.entries(over ?? {})) {
    if (typeof value === 'string' && name in DEFAULT_THEME) out[name as keyof ThemeTokens] = value
  }
  return out
}
