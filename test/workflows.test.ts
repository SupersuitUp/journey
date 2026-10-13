// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const publish = readFileSync(resolve(__dirname, '../.github/workflows/publish.yml'), 'utf8')
// One step of the job, from its `- name:` line to the next step.
const step = (name: string) => {
  const from = publish.indexOf(`- name: ${name}`)
  expect(from, name).toBeGreaterThan(-1)
  const next = publish.indexOf('\n      - ', from + 1)
  return publish.slice(from, next === -1 ? undefined : next)
}

describe('the publish workflow', () => {
  it('publishes only on a pushed v* tag', () => {
    expect(step('Publish')).toMatch(/\n\s+if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)\n/)
    expect(publish.match(/npm publish/g)).toHaveLength(1)
    expect(publish).toMatch(/on:\n  push:\n    tags: \["v\*"\]\n  workflow_dispatch:\n\n/)
  })

  it('a run started by hand has no input that could make it publish', () => {
    expect(publish).not.toMatch(/inputs\./)
    expect(publish).not.toMatch(/dry_run/)
    expect(step('Dry run only')).toMatch(/if: github\.event_name != 'push' \|\| !startsWith\(github\.ref, 'refs\/tags\/v'\)/)
  })

  it('keeps its guards: the tag matches the version, the version is not on npm yet, and the scan is required', () => {
    expect(step('Refuse a tag that disagrees with package.json')).toContain('exit 1')
    expect(step('Refuse a version already on npm')).toContain('exit 1')
    expect(publish).toContain('node scripts/private-words.mjs --require')
    expect(publish).not.toMatch(/^\s+registry-url:/m)
    expect(publish).not.toMatch(/^\s+NODE_AUTH_TOKEN:/m)
  })
})
