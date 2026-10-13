import { describe, expect, it } from 'vitest'
import { dayHash, visibleKeys } from './day-hash.js'
import type { Item } from './types.js'

const item = (key: string, extra: Partial<Item<'ada' | 'bo'>> = {}): Item<'ada' | 'bo'> =>
  ({ key, kind: 'shipped', at: '2026-10-12T15:00:00.000Z', by: ['ada'], title: key, addedAt: '2026-10-12T15:01:00.000Z', ...extra })
const items = (...list: Item<'ada' | 'bo'>[]) => Object.fromEntries(list.map((i) => [i.key, i]))

describe('dayHash', () => {
  it('is sixteen hex characters, the same for the same keys in any order', () => {
    const one = dayHash(items(item('a:1'), item('b:2')))
    const two = dayHash(items(item('b:2'), item('a:1')))
    expect(one).toMatch(/^[0-9a-f]{16}$/)
    expect(two).toBe(one)
    expect(dayHash({})).toMatch(/^[0-9a-f]{16}$/)
  })

  it('changes when an item arrives', () => {
    expect(dayHash(items(item('a:1'), item('b:2')))).not.toBe(dayHash(items(item('a:1'))))
  })

  it('leaves removed items out, so a removal changes it and a day reads as if the item never came', () => {
    const removed = item('b:2', { removed: { by: 'bo', at: '2026-10-12T16:00:00.000Z' } })
    expect(dayHash(items(item('a:1'), removed))).toBe(dayHash(items(item('a:1'))))
    expect(visibleKeys(items(item('a:1'), removed))).toEqual(['a:1'])
  })

  it('counts a second machine key for the same call, so a second set of notes changes it', () => {
    expect(dayHash(items(item('a:1', { aka: ['x:9'] })))).not.toBe(dayHash(items(item('a:1'))))
    expect(visibleKeys(items(item('b:2'), item('a:1', { aka: ['x:9'] })))).toEqual(['a:1', 'b:2', 'x:9'])
  })

  it('does not change when only the words of an item change', () => {
    expect(dayHash(items(item('a:1', { title: 'one' })))).toBe(dayHash(items(item('a:1', { title: 'two' }))))
  })
})
