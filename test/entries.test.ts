// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// What each entry point hands out, by name. A name added or dropped here is a change to the
// package's public face, so it is made on purpose, in this list, and never by an `export *`.
const names = async (path: string) => Object.keys(await import(path)).sort()
const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8')

describe('the root entry', () => {
  it('exports the refusal, the validators, the formatters, the statuses and the caps, and nothing else', async () => {
    expect(await names('../src/index.js')).toEqual([
      'ACCOUNT_MAX', 'AKA_MAX', 'CONTRIBUTE_STATUSES', 'DAYS_PAGE_DEFAULT', 'DAYS_PAGE_MAX', 'DAY_MAX_BYTES', 'DAY_MAX_ITEMS',
      'ITEMS_PER_CALL', 'ITEM_KINDS', 'KEY_MAX', 'LINE_MAX', 'RuleError', 'SUMMARY_MAX', 'THUMBS_PER_DAY', 'TITLE_MAX',
      'VIDEO_MAX_DURATION_SEC', 'WORDS_MAX', 'dayIn', 'formatDay', 'formatWhen', 'fromLine', 'isRuleError', 'validateAt', 'validateDay', 'validateKey',
    ])
  })

  it('is a list of names', () => {
    expect(source('src/index.ts')).not.toMatch(/export\s+(type\s+)?\*/)
  })
})

describe('the server entry', () => {
  it('exports the store, the handlers and the wrapper every route answers through', async () => {
    expect(await names('../src/server/index.js')).toEqual(['createJourneyHandlers', 'createJourneyStore', 'handle'])
  })

  it('is a list of names, behind server-only', () => {
    expect(source('src/server/index.ts')).not.toMatch(/export\s+(type\s+)?\*/)
    expect(source('src/server/index.ts').trimStart()).toMatch(/^import 'server-only'/)
  })
})

describe('the client entry', () => {
  it('exports components, and nothing that is not one', async () => {
    const entry = await import('../src/client/index.js')
    expect(Object.keys(entry).sort()).toEqual(['JourneyDay', 'JourneyHome', 'JourneyProvider'])
    for (const value of Object.values(entry)) expect(typeof value).toBe('function')
  })

  it('is a client boundary with a list of names', () => {
    expect(source('src/client/index.ts').trimStart()).toMatch(/^'use client'/)
    expect(source('src/client/index.ts')).not.toMatch(/export\s+(type\s+)?\*/)
  })

  it('keeps no look and no addresses in a module: nothing under src/client is declared with let', () => {
    for (const file of ['theme.ts', 'config.ts', 'context.tsx', 'provider.tsx']) expect(source(`src/client/${file}`), file).not.toMatch(/^\s*(export\s+)?let\s/m)
  })
})
