// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

// These tests spawn processes, which a loaded machine can slow past the default five seconds.
vi.setConfig({ testTimeout: 60_000 })
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const SCRIPT = join(ROOT, 'scripts/private-words.mjs')
const WORD = ['zebra', 'corn'].join('')
const ABSENT = ['quagga', 'wump'].join('')

// A throwaway repository holding one file under src/.
function repoWith(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'private-words-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'a.ts'), content)
  return dir
}
const check = (root: string, env: Record<string, string>, ...flags: string[]) =>
  spawnSync('node', [SCRIPT, '--root', root, ...flags], { encoding: 'utf8', env: { ...process.env, PRIVATE_WORDS: '', PRIVATE_WORDS_FILE: '', ...env } })

describe('the private-words check', () => {
  it('refuses a listed word, names the place, and never prints the word', () => {
    const r = check(repoWith(`export const a = 1\n// hello ${WORD}\n`), { PRIVATE_WORDS: WORD })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('src/a.ts:2 contains a private word')
    expect(r.stdout + r.stderr).not.toContain(WORD)
  })

  it('catches the word in any case and joined onto another', () => {
    expect(check(repoWith(`const my${WORD.toUpperCase()}Thing = 1\n`), { PRIVATE_WORDS: WORD }).status).toBe(1)
  })

  it('passes a file without it', () => {
    const r = check(repoWith('// hello world\n'), { PRIVATE_WORDS: `${WORD}, ${ABSENT}` })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('no private words in 1 files')
  })

  it('reads the list from a file outside the repository', () => {
    const list = join(mkdtempSync(join(tmpdir(), 'private-list-')), 'words.txt')
    writeFileSync(list, `${ABSENT}\n${WORD}\n`)
    expect(check(repoWith(`// ${WORD}\n`), { PRIVATE_WORDS_FILE: list }).status).toBe(1)
  })

  // A throwaway repository with one clean source file and one more file at the path given.
  function repoHolding(path: string, content: string, ignore = ''): string {
    const dir = repoWith('export const a = 1\n')
    mkdirSync(join(dir, path, '..'), { recursive: true })
    if (ignore) writeFileSync(join(dir, '.gitignore'), ignore)
    writeFileSync(join(dir, path), content)
    return dir
  }

  it.each([
    'LICENSE', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', '.gitignore', 'README.md', 'CHANGELOG.md',
    'test/consumer/app/page.tsx', 'test/consumer/lib/host.ts', 'test/consumer/package.json', 'scripts/x.mjs', '.github/workflows/ci.yml',
  ])('reads %s', (path) => {
    const r = check(repoHolding(path, `one\n${WORD}\n`), { PRIVATE_WORDS: WORD })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`${path}:2 contains a private word`)
  })

  it.each(['test/consumer/node_modules/dep/index.js', 'test/consumer/.next/server/page.js', 'node_modules/dep/index.js'])(
    'does not read %s, ignored by git or not', (path) => {
      expect(check(repoHolding(path, `${WORD}\n`, 'node_modules/\ntest/consumer/node_modules/\ntest/consumer/.next/\n'), { PRIVATE_WORDS: WORD }).status).toBe(0)
      expect(check(repoHolding(path, `${WORD}\n`), { PRIVATE_WORDS: WORD }).status).toBe(0)
    },
  )

  it('with no list it skips and says so, unless the run requires one', () => {
    const skipped = check(repoWith(`// ${WORD}\n`), {})
    expect(skipped.status).toBe(0)
    expect(skipped.stdout).toContain('skipped, no list')
    const required = check(repoWith('// clean\n'), {}, '--require')
    expect(required.status).toBe(1)
    expect(required.stdout).toContain('requires one')
  })

  it('passes this repository against a word it does not hold', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf8', env: { ...process.env, PRIVATE_WORDS: ABSENT, PRIVATE_WORDS_FILE: '' } })
    expect(r.stdout).toMatch(/no private words in \d+ files/)
    expect(r.status).toBe(0)
  })
})
