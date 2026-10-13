import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { JourneyProvider } from './provider.js'
import { JourneyHome } from './journey-home.js'
import { JourneyDay } from './journey-day.js'
import { DEFAULT_THEME } from './theme.js'
import type { DayRow, DayView } from '../types.js'

const CONFIG = { apiBase: '/api/journey', pageBase: '/journey' }
const ROW: DayRow = { day: '2026-10-12', firstLine: 'They shipped.', thumbs: [], count: 1 }
const VIEW: DayView = {
  day: '2026-10-12', account: null, accountPending: false, removedCount: 0,
  groups: [{ name: 'calls', items: [] }, { name: 'media', items: [] }, { name: 'texts', items: [] }, { name: 'shipped', items: [{ key: 'shipped:r1', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', by: ['ada'], title: 'Released 0.1.0', summaries: [] }] }],
}
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

describe('JourneyProvider', () => {
  it('links every day to wherever the app keeps its pages', () => {
    render(<JourneyProvider config={{ ...CONFIG, pageBase: '/days' }}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/days/2026-10-12')
  })

  it('hands every screen under it the look the app set, and the default for what the app left out', () => {
    render(<JourneyProvider config={CONFIG} theme={{ ink: '#202020' }}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    expect(screen.getByText('They shipped.')).toHaveStyle({ color: rgb('#202020') })
    expect(screen.getByText(/Monday, October 12/).parentElement).toHaveStyle({ color: rgb(DEFAULT_THEME.muted) })
  })

  it('with no theme it draws in the default look', () => {
    render(<JourneyProvider config={CONFIG}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    expect(screen.getByText('They shipped.')).toHaveStyle({ color: rgb(DEFAULT_THEME.ink) })
  })

  it('a theme value left undefined does not erase the default', () => {
    render(<JourneyProvider config={CONFIG} theme={{ ink: undefined }}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    expect(screen.getByText('They shipped.')).toHaveStyle({ color: rgb(DEFAULT_THEME.ink) })
  })

  it('two providers on one page share nothing: each screen has its own look and its own addresses', () => {
    render(
      <>
        <JourneyProvider config={{ ...CONFIG, pageBase: '/first' }} theme={{ ink: '#010203' }}><JourneyHome days={[{ ...ROW, firstLine: 'First.' }]} next={null} /></JourneyProvider>
        <JourneyProvider config={{ ...CONFIG, pageBase: '/second' }}><JourneyHome days={[{ ...ROW, firstLine: 'Second.' }]} next={null} /></JourneyProvider>
        <JourneyProvider config={{ ...CONFIG, pageBase: '/third' }} theme={{ ink: '#0a0b0c' }}><JourneyDay view={VIEW} names={{ ada: 'Ada' }} /></JourneyProvider>
      </>,
    )
    expect(screen.getByText('First.')).toHaveStyle({ color: rgb('#010203') })
    expect(screen.getByText('Second.')).toHaveStyle({ color: rgb(DEFAULT_THEME.ink) })
    expect(screen.getByText('Released 0.1.0')).toHaveStyle({ color: rgb('#0a0b0c') })
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/first/2026-10-12', '/second/2026-10-12'])
  })

  it('a look set for one render is gone from the next: two requests rendered on one server share nothing', () => {
    const themed = renderToString(<JourneyProvider config={{ ...CONFIG, pageBase: '/one' }} theme={{ ink: '#010203' }}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    const plain = renderToString(<JourneyProvider config={{ ...CONFIG, pageBase: '/two' }}><JourneyHome days={[ROW]} next={null} /></JourneyProvider>)
    expect(themed).toContain('#010203')
    expect(themed).toContain('/one/2026-10-12')
    expect(plain).not.toContain('#010203')
    expect(plain).not.toContain('/one/')
    expect(plain).toContain(DEFAULT_THEME.ink)
  })

  it('a screen drawn outside a provider says what is missing', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<JourneyHome days={[ROW]} next={null} />)).toThrow('Journey is not configured: render its screens inside <JourneyProvider>')
    expect(() => render(<JourneyDay view={VIEW} names={{}} />)).toThrow('Journey is not configured')
    quiet.mockRestore()
  })
})
