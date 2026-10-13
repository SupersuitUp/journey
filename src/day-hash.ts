import type { Item } from './types.js'

// A change detector, not a secret: 32-bit FNV-1a run from two starting points, printed as sixteen
// hex characters. Written out here so the root entry imports nothing and loads anywhere.
function fnv(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Every key a visible item answers to: its own, and another machine's key for the same call. */
export function visibleKeys<M extends string>(items: Record<string, Item<M>>): string[] {
  const keys: string[] = []
  for (const it of Object.values(items)) {
    if (it.removed) continue
    keys.push(it.key, ...(it.aka ?? []))
  }
  return keys.sort()
}

/**
 * What an account was written from. For each visible item it covers the item's key, its second
 * keys, who contributed it and whether others were there, so it changes when an item arrives,
 * when a second machine merges into a call, and when an item is removed or restored. It leaves
 * the words out, and it does not change when nothing did, so a machine rewrites a day only when
 * there is something new to say.
 */
export function dayHash<M extends string>(items: Record<string, Item<M>>): string {
  const rows = Object.values(items)
    .filter((it) => !it.removed)
    .map((it) => [it.key, [...(it.aka ?? [])].sort(), [...it.by].sort(), it.others === true])
    .sort((a, b) => (a[0] as string < (b[0] as string) ? -1 : a[0] === b[0] ? 0 : 1))
  const text = JSON.stringify(rows)
  return fnv(text, 0x811c9dc5) + fnv(text, 0x01234567)
}
