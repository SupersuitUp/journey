// The look Journey draws with, handed in by the app. Live bindings: a component reads INK when it
// renders, so setTheme() before the first render is all an app does.
export interface ThemeTokens {
  serif: string; bg: string; ink: string; muted: string; hairline: string; onInk: string
  accent: string; danger: string
}

export const DEFAULT_THEME: ThemeTokens = {
  serif: 'Georgia, serif', bg: '#ffffff', ink: '#1a1a1a', muted: '#767676', hairline: '#ececec', onInk: '#ffffff',
  accent: '#d94c63', danger: '#a33a3a',
}

export let SERIF = DEFAULT_THEME.serif
export let BG = DEFAULT_THEME.bg
export let INK = DEFAULT_THEME.ink
export let MUTED = DEFAULT_THEME.muted
export let HAIRLINE = DEFAULT_THEME.hairline
export let ON_INK = DEFAULT_THEME.onInk
export let ACCENT = DEFAULT_THEME.accent
export let DANGER = DEFAULT_THEME.danger

export function setTheme(t: Partial<ThemeTokens>): void {
  if (t.serif !== undefined) SERIF = t.serif
  if (t.bg !== undefined) BG = t.bg
  if (t.ink !== undefined) INK = t.ink
  if (t.muted !== undefined) MUTED = t.muted
  if (t.hairline !== undefined) HAIRLINE = t.hairline
  if (t.onInk !== undefined) ON_INK = t.onInk
  if (t.accent !== undefined) ACCENT = t.accent
  if (t.danger !== undefined) DANGER = t.danger
}
