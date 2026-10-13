// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// These tests spawn processes, which a loaded machine can slow past the default five seconds.
vi.setConfig({ testTimeout: 60_000 })
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')

// A throwaway tree whose src/ holds one file.
function treeWith(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'comment-dates-'))
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', name), content)
  return dir
}
const check = (root: string) => spawnSync('node', [join(ROOT, 'scripts/check-comment-dates.mjs'), '--root', root], { encoding: 'utf8' })

describe('the comment-dates check', () => {
  it('refuses a line comment with a date, and names the file and line', () => {
    const r = check(treeWith('a.ts', 'export const a = 1\n// measured 2031-04-05 on a phone\n'))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('comment with a date at src/a.ts:2')
  })

  it('refuses a block comment and a JSX comment with a date', () => {
    expect(check(treeWith('b.ts', '/*\n * fixed 2031-04-05\n */\nexport const b = 1\n')).status).toBe(1)
    expect(check(treeWith('c.tsx', 'export const c = () => <p>{/* seen 2031-04-05 */}x</p>\n')).status).toBe(1)
  })

  it('refuses a trailing comment with a date', () => {
    expect(check(treeWith('d.ts', 'export const d = 1 // 2031-04-05\n')).status).toBe(1)
  })

  it('allows a date value in code, in a string, and a url with slashes', () => {
    const r = check(treeWith('e.ts', "export const e = { at: '2031-04-05T10:00:00.000Z', u: 'https://x.test/a' }\nexport const f = `2031-04-05`\n"))
    expect(r.status).toBe(0)
  })

  it('passes a comment without a date', () => {
    expect(check(treeWith('g.ts', '// the format is YYYY-MM-DD\nexport const g = 1\n')).status).toBe(0)
  })

  it('passes this repository', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts/check-comment-dates.mjs')], { encoding: 'utf8' })
    expect(r.stdout + r.stderr).toContain('no dates in comments under src/')
    expect(r.status).toBe(0)
  })
})
