// iOS Safari zooms the page when a focused input, textarea or select is under 16px. Every text
// control a screen renders must carry an explicit size of 16px or more (text-base or larger, or
// text-[16px]+); file pickers are hidden and exempt. Keep the look with padding, not a smaller font.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = __dirname
const sources = readdirSync(DIR).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))

// The opening tag, read to its closing `>` outside any {braces} so `=>` inside handlers does not end it.
function openingTags(src: string): string[] {
  const out: string[] = []
  const re = /<(input|textarea|select)\b/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0
    let i = m.index
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0 && src[i - 1] !== '=') break
    }
    out.push(src.slice(m.index, i + 1))
  }
  return out
}

const BIG = /\btext-(base|lg|xl|[2-9]xl)\b/
const BIG_PX = /\btext-\[(\d+(?:\.\d+)?)px\]/
function sizeOk(tag: string): boolean {
  if (/\btext-(xs|sm)\b/.test(tag)) return false
  const px = BIG_PX.exec(tag)
  if (px) return Number(px[1]) >= 16
  return BIG.test(tag)
}

describe('form controls stay at 16px or more', () => {
  const found = sources.flatMap((n) => openingTags(readFileSync(join(DIR, n), 'utf8')).map((tag) => ({ n, tag })))

  it('reads the screens it is meant to police', () => {
    expect(sources).toContain('journey-home.tsx')
  })

  for (const { n, tag } of found) {
    if (/type="file"/.test(tag)) continue
    it(`${n}: ${tag.replace(/\s+/g, ' ').slice(0, 60)}`, () => {
      expect(sizeOk(tag), tag).toBe(true)
    })
  }

  it('the check itself rejects text-sm, text-xs and a small px size', () => {
    expect(sizeOk('<input className="h-11 text-sm" />')).toBe(false)
    expect(sizeOk('<select className="text-xs" />')).toBe(false)
    expect(sizeOk('<textarea className="text-[15px]" />')).toBe(false)
    expect(sizeOk('<select className="h-11" />')).toBe(false)
    expect(sizeOk('<input className="text-base" />')).toBe(true)
    expect(sizeOk('<textarea className="text-[17px]" />')).toBe(true)
  })
})
