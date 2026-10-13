#!/usr/bin/env node
// A public package names no person, app or workspace. The list of words lives OUTSIDE the
// repository (a file named by PRIVATE_WORDS_FILE, or the words themselves in PRIVATE_WORDS, one
// per line or separated by commas), because any copy kept here, hashed or not, would publish the
// words it forbids: a short word behind an unsalted hash is recovered by guessing.
//
//   node scripts/private-words.mjs [--require] [--root <dir>]
//
// With no list the check is skipped and says so. A release must not ship unscanned, so the
// publish workflow passes --require, which turns a missing list into a failure.
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const argRoot = process.argv.indexOf('--root')
const root = argRoot > 0 ? resolve(process.argv[argRoot + 1]) : fileURLToPath(new URL('..', import.meta.url))
const SCANNED = ['src', 'test', 'scripts', '.github', 'README.md', 'CHANGELOG.md', 'package.json']

const raw = process.env.PRIVATE_WORDS_FILE ? readFileSync(process.env.PRIVATE_WORDS_FILE, 'utf8') : process.env.PRIVATE_WORDS ?? ''
const words = [...new Set(raw.split(/[\n,]/).map((w) => w.trim().toLowerCase()).filter(Boolean))]
if (!words.length) {
  if (process.argv.includes('--require')) {
    console.log('private-words: no list, and this run requires one (set the PRIVATE_WORDS secret)')
    process.exit(1)
  }
  console.log('private-words: skipped, no list (set PRIVATE_WORDS_FILE or PRIVATE_WORDS)')
  process.exit(0)
}

// Tracked files AND new ones not yet committed (but not ignored ones): the check runs before the
// commit that would add a leak, so reading only what git already tracks would pass it.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SCANNED], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean)
let hits = 0
let read = 0
for (const file of files) {
  const full = join(root, file)
  if (!existsSync(full)) continue
  const buf = readFileSync(full)
  if (buf.subarray(0, 8192).includes(0)) continue
  read++
  // A substring match, so a word joined onto another one is still caught. The hit names the
  // place and never the word.
  buf.toString('utf8').toLowerCase().split('\n').forEach((line, i) => {
    if (words.some((w) => line.includes(w))) { console.log(`${file}:${i + 1} contains a private word`); hits++ }
  })
}
if (hits) process.exit(1)
console.log(`no private words in ${read} files`)
