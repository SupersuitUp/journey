import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as renderBare, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { JourneyHome } from './journey-home.js'
import { JourneyProvider } from './provider.js'
import type { ThemeTokens } from './theme.js'
import type { DayRow } from '../types.js'

// Every screen is drawn the way an app draws it: inside the provider that says where things are.
const render = (ui: ReactElement, theme?: Partial<ThemeTokens>) =>
  renderBare(<JourneyProvider config={{ apiBase: '/api/journey', pageBase: '/journey' }} theme={theme}>{ui}</JourneyProvider>)

const WRITTEN: DayRow = { day: '2026-10-12', firstLine: 'Ada and Bo planned the week.', thumbs: ['https://img/1.jpg', 'https://img/2.jpg'], count: 6 }
const BARE: DayRow = { day: '2026-10-11', firstLine: null, thumbs: [], count: 3 }
const ONE: DayRow = { day: '2026-10-10', firstLine: null, thumbs: [], count: 1 }

describe('JourneyHome', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('says so when there is nothing yet', () => {
    render(<JourneyHome days={[]} next={null} />)
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('lists days in the order given, each with its date and the first line of its account', () => {
    render(<JourneyHome days={[WRITTEN, BARE]} next={null} />)
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/journey/2026-10-12', '/journey/2026-10-11'])
    expect(links[0]).toHaveTextContent(/Monday, October 12/)
    expect(links[0]).toHaveTextContent('Ada and Bo planned the week.')
  })

  it('shows a strip of that day media', () => {
    const { container } = render(<JourneyHome days={[WRITTEN]} next={null} />)
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://img/1.jpg', 'https://img/2.jpg'])
  })

  it('a day not written up yet says how much is on it', () => {
    render(<JourneyHome days={[BARE, ONE]} next={null} />)
    expect(screen.getByText('3 items, not written up yet')).toBeInTheDocument()
    expect(screen.getByText('1 item, not written up yet')).toBeInTheDocument()
  })

  it('marks the days the app says are new', () => {
    render(<JourneyHome days={[WRITTEN, BARE]} next={null} newDays={['2026-10-11']} />)
    expect(screen.getAllByLabelText('New')).toHaveLength(1)
    expect(screen.getAllByRole('link')[1]).toContainElement(screen.getByLabelText('New'))
  })

  it('offers earlier days only when there are some', () => {
    render(<JourneyHome days={[WRITTEN]} next={null} />)
    expect(screen.queryByRole('button', { name: 'Earlier days' })).toBeNull()
  })

  it('loads the next page from the cursor and adds it below', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ days: [BARE], next: null }))
    vi.stubGlobal('fetch', fetchSpy)
    render(<JourneyHome days={[WRITTEN]} next="2026-10-12" />)
    fireEvent.click(screen.getByRole('button', { name: 'Earlier days' }))
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(2))
    expect(fetchSpy).toHaveBeenCalledWith('/api/journey/days?before=2026-10-12')
    expect(screen.getAllByRole('link')[1]).toHaveAttribute('href', '/journey/2026-10-11')
    expect(screen.queryByRole('button', { name: 'Earlier days' })).toBeNull()
  })

  it('says so when the next page does not load, and lets the person try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    render(<JourneyHome days={[WRITTEN]} next="2026-10-12" />)
    fireEvent.click(screen.getByRole('button', { name: 'Earlier days' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load earlier days. Try again.')
    expect(screen.getByRole('button', { name: 'Earlier days' })).toBeEnabled()
  })

  it('draws in the colours the app set', () => {
    render(<JourneyHome days={[WRITTEN]} next={null} />, { ink: '#010203' })
    expect(screen.getByText('Ada and Bo planned the week.')).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  })
})
