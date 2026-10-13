import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as renderBare, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { JourneyDay } from './journey-day.js'
import { JourneyProvider } from './provider.js'
import type { ThemeTokens } from './theme.js'
import type { DayView, ItemView, RemovedRow } from '../types.js'

// Every screen is drawn the way an app draws it: inside the provider that says where things are.
const render = (ui: ReactElement, theme?: Partial<ThemeTokens>) =>
  renderBare(<JourneyProvider config={{ apiBase: '/api/journey', pageBase: '/journey' }} theme={theme}>{ui}</JourneyProvider>)

const NAMES = { ada: 'Ada', bo: 'Bo' }
const DAY = '2026-10-12'
const API = `/api/journey/days/${DAY}`
const CALL: ItemView = { key: 'conversations:a1', kind: 'call', at: '2026-10-12T15:00:00.000Z', by: ['ada', 'bo'], title: 'Weekly sync', summaries: [{ by: 'ada', text: 'Notes from the first machine.' }, { by: 'bo', text: 'Notes from the second machine.' }] }
const CLIENT_CALL: ItemView = { key: 'conversations:a2', kind: 'call', at: '2026-10-12T18:00:00.000Z', by: ['bo'], title: 'Client call', line: 'Walked through the install.', summaries: [], others: true }
const PHOTO: ItemView = { key: 'camera-roll:p1', kind: 'photo', at: '2026-10-12T15:20:00.000Z', by: ['bo'], summaries: [], media: { kind: 'photo', width: 3024, height: 4032, thumbUrl: 'https://img/t.jpg', displayUrl: 'https://img/d.jpg' } }
const CLIP: ItemView = { key: 'camera-roll:v1', kind: 'video', at: '2026-10-12T15:40:00.000Z', by: ['ada'], title: 'Whiteboard walk', summaries: [], media: { kind: 'video', width: 1920, height: 1080, thumbUrl: 'https://img/poster.jpg', displayUrl: 'https://img/poster.jpg', videoUrl: 'https://img/v.mp4', durationSec: 62.5 } }
const TEXT: ItemView = { key: 'messages:t1', kind: 'text', at: '2026-10-12T16:30:00.000Z', by: ['bo'], words: 'Shipping it today.', summaries: [] }
const SHIPPED: ItemView = { key: 'shipped:repo/v0.1.0', kind: 'shipped', at: '2026-10-12T21:00:00.000Z', by: ['ada'], title: 'Released 0.1.0', summaries: [] }

const view = (extra: Partial<DayView> = {}): DayView => ({
  day: DAY,
  account: { text: 'Ada and Bo planned the week.\n\nThen they shipped.', by: 'ada', at: '2026-10-13T09:00:00.000Z' },
  accountPending: false,
  groups: [
    { name: 'calls', items: [CALL, CLIENT_CALL] },
    { name: 'media', items: [PHOTO, CLIP] },
    { name: 'texts', items: [TEXT] },
    { name: 'shipped', items: [SHIPPED] },
  ],
  removedCount: 0,
  ...extra,
})
const without = (key: string, removedCount: number): DayView =>
  view({ groups: view().groups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== key) })), removedCount })
const REMOVED: RemovedRow[] = [
  { key: 'shipped:repo/v0.1.0', kind: 'shipped', title: 'Released 0.1.0', by: 'bo', at: '2026-10-12T22:05:00.000Z' },
  { key: 'camera-roll:p9', kind: 'photo', by: 'ada', at: '2026-10-12T22:00:00.000Z' },
]

// The server, played by a list of routes: the first one that answers a request wins.
type Route = (url: string, method: string) => Response | undefined
function serve(...routes: Route[]) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    for (const r of routes) {
      const res = r(String(input), init?.method ?? 'GET')
      if (res) return res
    }
    return new Response('{}', { status: 500 })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}
const day = (v: DayView): Route => (url, method) => (method === 'GET' && url === API ? Response.json(v) : undefined)
const removedList = (rows: RemovedRow[]): Route => (url, method) => (method === 'GET' && url === `${API}/removed` ? Response.json({ removed: rows }) : undefined)
const item = (method: 'DELETE' | 'POST', status = 200, body: unknown = {}): Route => (url, m) => (m === method && url.startsWith(`${API}/item?key=`) ? new Response(JSON.stringify(body), { status }) : undefined)
const rowOf = (title: string) => screen.getByText(title).closest('li') as HTMLElement

afterEach(() => { vi.unstubAllGlobals() })

describe('JourneyDay', () => {
  it('opens with the date and the account, a paragraph at a time', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByText(/Monday, October 12/)).toBeInTheDocument()
    expect(screen.getByText('Ada and Bo planned the week.')).toBeInTheDocument()
    expect(screen.getByText('Then they shipped.')).toBeInTheDocument()
  })

  it('then calls, photos and video, texts and shipped work, in that order', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Calls', 'Photos and video', 'Texts', 'Shipped'])
    expect(within(screen.getByRole('region', { name: 'Calls' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('leaves out a group with nothing in it', () => {
    render(<JourneyDay view={without('messages:t1', 0)} names={NAMES} />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Calls', 'Photos and video', 'Shipped'])
  })

  it('marks each item with whose machine it came from', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByText('From Ada and Bo')).toBeInTheDocument()
    expect(screen.getAllByText('From Ada')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Texts' })).getByText('From Bo')).toBeInTheDocument()
  })

  it('shows a call with both sets of notes, each under its contributor name', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByText('Notes from the first machine.')).toHaveTextContent('Ada: Notes from the first machine.')
    expect(screen.getByText('Notes from the second machine.')).toHaveTextContent('Bo: Notes from the second machine.')
  })

  it('shows a call where others were present as its title and its one line, and says so', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByText('Walked through the install.')).toBeInTheDocument()
    expect(screen.getByText('From Bo · Others were present')).toBeInTheDocument()
  })

  it('draws a photo and plays a video', () => {
    const { container } = render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByRole('img', { name: 'Photo' })).toHaveAttribute('src', 'https://img/d.jpg')
    const video = container.querySelector('video')
    expect(video).toHaveAttribute('src', 'https://img/v.mp4')
    expect(video).toHaveAttribute('poster', 'https://img/poster.jpg')
  })

  it('quotes a text moment', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getByText('Shipping it today.').tagName).toBe('BLOCKQUOTE')
  })

  it('says a day is not written up yet, or is being written again', () => {
    const { unmount } = render(<JourneyDay view={view({ account: null })} names={NAMES} />)
    expect(screen.getByText('This day has not been written up yet.')).toBeInTheDocument()
    unmount()
    render(<JourneyDay view={view({ account: null, accountPending: true })} names={NAMES} />)
    expect(screen.getByText('The account of this day is being written again.')).toBeInTheDocument()
  })

  it('has a Remove control on every item', () => {
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.getAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Weekly sync', 'Remove Client call', 'Remove Photo', 'Remove Whiteboard walk', 'Remove Shipping it today.', 'Remove Released 0.1.0',
    ])
  })

  it('removes an item, then draws the day as the server now has it', async () => {
    const fetchSpy = serve(item('DELETE'), day(without('shipped:repo/v0.1.0', 1)))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByText('Released 0.1.0')).toBeNull())
    expect(fetchSpy).toHaveBeenCalledWith(`${API}/item?key=shipped%3Arepo%2Fv0.1.0`, { method: 'DELETE' })
    expect(screen.getByRole('button', { name: '1 item removed' })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says so on the row when a removal does not go through, and leaves the item where it was', async () => {
    serve(item('DELETE', 500))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not removed. Try again.')
    expect(within(rowOf('Released 0.1.0')).getByRole('alert')).toHaveTextContent('Not removed. Try again.')
    expect(within(rowOf('Weekly sync')).queryByRole('alert')).toBeNull()
    expect(screen.getByText('Released 0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Released 0.1.0' })).toBeEnabled()
  })

  it('shows the server own words on the row when it gave some', async () => {
    serve(item('DELETE', 404, { error: 'no such item on this day' }))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    expect(await within(rowOf('Released 0.1.0')).findByRole('alert')).toHaveTextContent('no such item on this day')
    expect(screen.queryByText('Not removed. Try again.')).toBeNull()
  })

  it('a 409 that says nothing of the item being removed is a removal that did not happen', async () => {
    serve(item('DELETE', 409, { error: 'the day changed' }), day(without('shipped:repo/v0.1.0', 1)))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    expect(await within(rowOf('Released 0.1.0')).findByRole('alert')).toHaveTextContent('the day changed')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('says Not removed when the request never reached the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    expect(await within(rowOf('Released 0.1.0')).findByRole('alert')).toHaveTextContent('Not removed. Try again.')
  })

  it('removed, though search could not follow: the item is gone, the day is read again, and a note says so in the server words', async () => {
    const fetchSpy = serve(item('DELETE', 409, { removed: true, error: 'Removed. Search will catch up shortly.' }), day(without('shipped:repo/v0.1.0', 1)))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByText('Released 0.1.0')).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent('Removed. Search will catch up shortly.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Not removed/)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledWith(API)
    expect(screen.getByRole('button', { name: '1 item removed' })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
    // The note does not stand in the way: every other item can still be removed.
    expect(screen.getByRole('button', { name: 'Remove Weekly sync' })).toBeEnabled()
  })

  it.each([401, 403])('a %i says the person is signed out, and does not invite another try', async (status) => {
    serve(item('DELETE', status))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    const alert = await within(rowOf('Released 0.1.0')).findByRole('alert')
    expect(alert).toHaveTextContent('You are signed out. Reload to sign in again.')
    expect(alert).not.toHaveTextContent(/try again/i)
    expect(screen.getByText('Released 0.1.0')).toBeInTheDocument()
  })

  it('the bare word this package answers a stranger with is read as what it means: signed out', async () => {
    serve(item('DELETE', 403, { error: 'private' }))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    expect(await within(rowOf('Released 0.1.0')).findByRole('alert')).toHaveTextContent(/^You are signed out. Reload to sign in again.$/)
  })

  it('a 403 that came with words shows those words', async () => {
    serve(item('DELETE', 403, { error: 'Your session ended.' }))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    const alert = await within(rowOf('Released 0.1.0')).findByRole('alert')
    expect(alert).toHaveTextContent('Your session ended.')
    expect(alert).not.toHaveTextContent(/try again/i)
  })

  it.each([
    ['answers an error', (): Route => (url, m) => (m === 'GET' && url === API ? new Response('{}', { status: 500 }) : undefined)],
    ['never arrives', (): Route => (url, m) => { if (m === 'GET' && url === API) throw new TypeError('Failed to fetch'); return undefined }],
  ])('removed, but the day could not be read again (the read %s): the item is gone here too, and a note says the page could not refresh', async (_name, failing) => {
    serve(item('DELETE', 200, { day: DAY, key: 'shipped:repo/v0.1.0', removedCount: 3 }), failing())
    render(<JourneyDay view={view({ removedCount: 2 })} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByText('Released 0.1.0')).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent('Removed. The page could not refresh. Reload to see the latest.')
    expect(screen.queryByText(/Not removed/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: '3 items removed' })).toBeInTheDocument()
    // The account may tell of what was just removed, and the server withholds it; so does the page.
    expect(screen.queryByText('Ada and Bo planned the week.')).toBeNull()
    expect(screen.getByText('The account of this day is being written again.')).toBeInTheDocument()
    expect(screen.getByText('Weekly sync')).toBeInTheDocument()
  })

  it('removed with a 409 and no fresh read: gone here, in the server words, with the note that the page could not refresh', async () => {
    serve(item('DELETE', 409, { removed: true, error: 'Removed. Search will catch up shortly.' }))
    render(<JourneyDay view={view({ account: null })} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByText('Released 0.1.0')).toBeNull())
    expect(screen.getByRole('status')).toHaveTextContent('Removed. Search will catch up shortly. The page could not refresh. Reload to see the latest.')
    expect(screen.getByRole('button', { name: '1 item removed' })).toBeInTheDocument()
    expect(screen.getByText('This day has not been written up yet.')).toBeInTheDocument()
  })

  it('a second tap on Yes, remove while the first is on its way sends nothing more', async () => {
    let answer: (res: Response) => void = () => {}
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Promise<Response>((resolve) => { answer = resolve })
      return Promise.resolve(Response.json(without('shipped:repo/v0.1.0', 1)))
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    const yes = screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' })
    fireEvent.click(yes)
    expect(yes).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Keep Released 0.1.0' })).toBeDisabled()
    fireEvent.click(yes)
    fireEvent.click(yes)
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
    answer(new Response('{}'))
    await waitFor(() => expect(screen.queryByText('Released 0.1.0')).toBeNull())
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1)
  })

  it('moves focus to Keep when it asks, and back to Remove when the person keeps the item', () => {
    serve()
    render(<JourneyDay view={view()} names={NAMES} />)
    expect(document.body).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    expect(screen.getByRole('button', { name: 'Keep Released 0.1.0' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Released 0.1.0' }))
    expect(screen.getByRole('button', { name: 'Remove Released 0.1.0' })).toHaveFocus()
  })

  it('gives focus back to Remove when a removal fails, so the note is read where the person is', async () => {
    serve(item('DELETE', 500))
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Released 0.1.0' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Remove Released 0.1.0' })).toHaveFocus()
  })

  it('every control is named by what it shows: its accessible name contains its visible words', async () => {
    serve(removedList(REMOVED))
    render(<JourneyDay view={view({ removedCount: 2 })} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    await screen.findByRole('button', { name: 'Restore Photo' })
    const named = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-label') && b.getAttribute('aria-label') !== 'Close')
    expect(named.map((b) => b.textContent)).toEqual(expect.arrayContaining(['Remove', 'Yes, remove', 'Keep', 'Restore']))
    for (const b of named) expect(b.getAttribute('aria-label')!.startsWith(`${b.textContent} `), b.getAttribute('aria-label')!).toBe(true)
  })

  it('asks once before removing, and Keep leaves the item alone', () => {
    const fetchSpy = serve()
    render(<JourneyDay view={view()} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Released 0.1.0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep Released 0.1.0' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove Released 0.1.0' })).toBeInTheDocument()
  })

  it('says nothing about removals when there are none, and counts them when there are', () => {
    const { unmount } = render(<JourneyDay view={view()} names={NAMES} />)
    expect(screen.queryByRole('button', { name: /removed$/ })).toBeNull()
    unmount()
    render(<JourneyDay view={view({ removedCount: 2 })} names={NAMES} />)
    expect(screen.getByRole('button', { name: '2 items removed' })).toBeInTheDocument()
  })

  it('opens what was removed: a title or a kind, who removed it and when, and nothing of the media', async () => {
    serve(removedList(REMOVED))
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    const sheet = await screen.findByRole('dialog', { name: 'Removed from this day' })
    expect(await within(sheet).findByText('Released 0.1.0')).toBeInTheDocument()
    expect(within(sheet).getByText(/Removed by Bo/)).toBeInTheDocument()
    expect(within(sheet).getByText(/Removed by Ada/)).toHaveTextContent(/^Photo · Removed by Ada · /)
    expect(within(sheet).getByRole('button', { name: 'Restore Photo' })).toBeInTheDocument()
    expect(sheet.querySelector('img, video')).toBeNull()
  })

  it('restores an item from the list, closes the list and draws the day again', async () => {
    const fetchSpy = serve(removedList(REMOVED), item('POST'), day(view({ removedCount: 1 })))
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchSpy).toHaveBeenCalledWith(`${API}/item?key=shipped%3Arepo%2Fv0.1.0`, { method: 'POST' })
    expect(await screen.findByText('Released 0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 item removed' })).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says so on the row when a restore does not go through, and keeps the list open', async () => {
    serve(removedList(REMOVED), item('POST', 500))
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Released 0.1.0' }))
    expect(await screen.findByText('Not restored. Try again.')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Restore Released 0.1.0' }).closest('li') as HTMLElement).getByRole('alert')).toHaveTextContent('Not restored. Try again.')
    expect(within(screen.getByRole('button', { name: 'Restore Photo' }).closest('li') as HTMLElement).queryByRole('alert')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Released 0.1.0' })).toBeEnabled()
  })

  it('a restore shows the server own words, and says signed out for a 401 or a 403 with none', async () => {
    serve(removedList(REMOVED), (url, m) => (m === 'POST' && url.includes('shipped') ? new Response(JSON.stringify({ error: 'no such item on this day' }), { status: 404 }) : undefined), item('POST', 401))
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Released 0.1.0' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no such item on this day')
    fireEvent.click(screen.getByRole('button', { name: 'Restore Photo' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You are signed out. Reload to sign in again.'))
    expect(screen.getByRole('alert')).not.toHaveTextContent(/try again/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('restored, but the day could not be read again: the list closes, the count drops, and a note says the page could not refresh', async () => {
    const unhandled = vi.fn()
    window.addEventListener('unhandledrejection', unhandled)
    process.on('unhandledRejection', unhandled)
    serve(removedList(REMOVED), item('POST', 200, { day: DAY, key: 'shipped:repo/v0.1.0', removedCount: 1 }), (url, m) => { if (m === 'GET' && url === API) throw new TypeError('Failed to fetch'); return undefined })
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Released 0.1.0' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByRole('status')).toHaveTextContent('Restored. The page could not refresh. Reload to see it.')
    expect(screen.getByRole('button', { name: '1 item removed' })).toBeInTheDocument()
    expect(screen.queryByText(/Not restored/)).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    window.removeEventListener('unhandledrejection', unhandled)
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('a second tap on Restore while the first is on its way sends nothing more', async () => {
    let answer: (res: Response) => void = () => {}
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Promise<Response>((resolve) => { answer = resolve })
      return Promise.resolve(String(input).endsWith('/removed') ? Response.json({ removed: REMOVED }) : Response.json(view({ removedCount: 1 })))
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<JourneyDay view={without('shipped:repo/v0.1.0', 2)} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    const restore = await screen.findByRole('button', { name: 'Restore Released 0.1.0' })
    fireEvent.click(restore)
    expect(restore).toBeDisabled()
    fireEvent.click(restore)
    answer(new Response('{}'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('says so when the list does not load', async () => {
    serve()
    render(<JourneyDay view={view({ removedCount: 1 })} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '1 item removed' }))
    expect(await screen.findByText('Could not load what was removed. Close this and try again.')).toBeInTheDocument()
  })

  it('closes the list on Close and on Escape', async () => {
    serve(removedList(REMOVED))
    render(<JourneyDay view={view({ removedCount: 2 })} names={NAMES} />)
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2 items removed' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('draws in the colours the app set', () => {
    render(<JourneyDay view={view()} names={NAMES} />, { ink: '#010203' })
    expect(screen.getByText('Weekly sync')).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  })
})
