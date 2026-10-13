import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { JourneyProvider } from './provider.js'
import { JourneyHome } from './journey-home.js'
import { clientConfig, configure } from './config.js'
import { BG, DEFAULT_THEME, INK, setTheme } from './theme.js'

const kept = clientConfig()

describe('JourneyProvider', () => {
  afterEach(() => { configure(kept); setTheme(DEFAULT_THEME) })

  it('configures Journey and its look before anything under it draws', () => {
    render(<JourneyProvider config={{ apiBase: '/api/days-of-ours', pageBase: '/days' }} theme={{ ink: '#202020' }}><p>inside</p></JourneyProvider>)
    expect(screen.getByText('inside')).toBeInTheDocument()
    expect(clientConfig()).toEqual({ apiBase: '/api/days-of-ours', pageBase: '/days' })
    expect(INK).toBe('#202020')
    expect(BG).toBe(DEFAULT_THEME.bg)
  })

  it('links every day to wherever the app keeps its pages', () => {
    render(
      <JourneyProvider config={{ ...kept, pageBase: '/days' }}>
        <JourneyHome days={[{ day: '2026-10-12', firstLine: 'They shipped.', thumbs: [], count: 1 }]} next={null} />
      </JourneyProvider>,
    )
    expect(screen.getByRole('link')).toHaveAttribute('href', '/days/2026-10-12')
  })

  it('hands every screen the look the app set, read at render time', () => {
    setTheme({ ink: '#101010', bg: '#fafafa' })
    expect(INK).toBe('#101010')
    expect(BG).toBe('#fafafa')
    setTheme(DEFAULT_THEME)
    expect(INK).toBe(DEFAULT_THEME.ink)
  })
})
